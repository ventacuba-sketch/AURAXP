-- Bloque: Push notifications reales (A-D del bloque pre-lanzamiento).
--
-- Arquitectura elegida, auditada primero (ver reporte de esta tarea para
-- el detalle completo de por qué):
-- - AURAXP es PWA (web) en iPhone/Android/desktop, no una app nativa
--   empaquetada -- la única tecnología de push que funciona en LOS TRES
--   (incluida una futura app nativa Expo, que también puede consumir Web
--   Push) es Web Push estándar (Service Worker + PushManager + VAPID),
--   NO Firebase Cloud Messaging ni Apple Push Notification service
--   directos (esos requieren una app nativa empaquetada con sus propios
--   certificados/keys, no aplican a una PWA). Confirmado: iOS Safari
--   soporta Web Push SOLO para una PWA ya instalada (Añadir a pantalla de
--   inicio) desde iOS 16.4+ -- no hay push en pestaña de Safari sin
--   instalar. Esto se documenta en el cliente (pushService.ts), no acá.
-- - UN SOLO choke point server-side: un trigger AFTER INSERT en
--   `notifications` (la tabla que YA usan las 4 vías reales:
--   create_direct_challenge/respond_direct_challenge/accept_challenge/
--   challengeResolution.ts) dispara la Edge Function `send-push` vía
--   pg_net (HTTP asíncrono, no bloqueante) -- ningún INSERT existente
--   necesita tocarse, "no romper Challenge directo ni clásico" queda
--   trivialmente cumplido: cero cambios en esas 4 rutas.
-- - Best-effort real, no solo de palabra: pg_net encola la request y
--   sigue -- no espera la respuesta HTTP dentro de la transacción que
--   crea el Challenge/notification, así que un push que falla (browser
--   sin permiso, endpoint caducado, Vault sin configurar todavía) NUNCA
--   puede revertir esa transacción. El trigger además envuelve todo en su
--   propio EXCEPTION handler por las dudas.
--
-- NOTA (re-alineación con producción): esta migración se reescribió para
-- ser 100% idempotente -- producción ya tiene todo este bloque aplicado
-- (vía una migración equivalente aplicada directamente durante una
-- auditoría), y su historial de migraciones NO tiene este archivo
-- marcado como corrido. Un futuro `supabase db push` va a intentar
-- ejecutar este archivo tal cual contra producción: cada sentencia de
-- abajo está escrita para no romper si el objeto ya existe (CREATE TABLE
-- IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, políticas con DROP POLICY
-- IF EXISTS antes de recrearlas, CREATE OR REPLACE FUNCTION/TRIGGER), y
-- para terminar en el mismo estado final tanto en una base nueva y vacía
-- como en producción (que ya lo tiene).

create extension if not exists pg_net;

-- ============================================================
-- push_subscriptions
-- ============================================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  -- Solo 'web' hoy (Web Push, ver arriba) -- deja lugar para diferenciar
  -- si algún día hay push nativo real (FCM/APNs vía una app Expo
  -- empaquetada) sin tener que migrar el esquema.
  platform text not null default 'web' check (platform in ('web')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- Nunca se borra la fila al desactivar/expirar -- soft-delete, para
  -- poder ver en el Dashboard cuántas suscripciones existieron alguna vez
  -- sin depender de logs. `send-push` la marca sola cuando el navegador
  -- devuelve 404/410 (endpoint caducado).
  revoked_at timestamptz,
  unique (endpoint)
);

-- Índice parcial: la query real de send-push es siempre "activas de este
-- usuario", igual criterio que notifications_user_id_unread_idx.
create index if not exists push_subscriptions_user_id_active_idx on push_subscriptions (user_id) where revoked_at is null;

alter table push_subscriptions enable row level security;

-- "Cada usuario gestiona solo sus subscriptions" (D), literal: sin
-- restricción de columnas -- a diferencia de profiles/scans, acá no hay
-- ningún campo que el propio dueño no deba poder tocar (no es un dato de
-- juego/integridad, es su propia preferencia de notificación).
drop policy if exists "push_subscriptions_select_own" on push_subscriptions;
create policy "push_subscriptions_select_own" on push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on push_subscriptions;
create policy "push_subscriptions_insert_own" on push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_own" on push_subscriptions;
create policy "push_subscriptions_update_own" on push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on push_subscriptions;
create policy "push_subscriptions_delete_own" on push_subscriptions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on push_subscriptions to authenticated;

-- ============================================================
-- Trigger: cada notification real intenta un push, best-effort
-- ============================================================
-- Requiere DOS secrets en Supabase Vault (paso manual, ver reporte -- no
-- se puede hacer desde una migración, son valores específicos del
-- proyecto):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/send-push', 'push_function_url');
--   select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'push_service_role_key');
-- Sin esos dos secrets, el trigger corre igual (no rompe nada) pero no
-- llama a ningún lado -- ver el `if ... is null then return new` abajo.
create or replace function public.notify_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_service_role_key';

  if v_url is null or v_key is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('notification_id', new.id)
  );

  return new;
exception when others then
  -- Best-effort real (D): cualquier fallo acá (Vault mal configurado,
  -- pg_net con problemas, lo que sea) nunca debe revertir el insert de la
  -- notification real que ya pasó -- eso sí importa, el push no.
  raise warning 'notify_push failed for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- Función de trigger -- nadie la llama directo (Postgres ya lo impide
-- estructuralmente: "trigger functions can only be called as triggers"),
-- pero se revoca el EXECUTE por defecto de PUBLIC igual, mismo criterio
-- que apply_coin_transaction/create_wallet_for_new_profile.
revoke execute on function public.notify_push() from public, anon, authenticated;

create or replace trigger notifications_push_trigger
  after insert on notifications
  for each row execute function public.notify_push();
