-- FREE/PRO: columnas nuevas en `profiles`, nada existente se toca ni se
-- recrea. Ver supabase/functions/_shared/dailyLimit.ts para la lógica de
-- límites que lee `plan`/`created_at`, y supabase/functions/dlocal-webhook
-- para dónde queda preparada (no activa todavía) la escritura de pro_*.

alter table profiles add column plan text not null default 'free';
alter table profiles add constraint profiles_plan_check check (plan in ('free', 'pro'));

-- Estado más fino que `plan`, separado a propósito: un pago fallido o una
-- cancelación puede necesitar bajar `plan` a 'free' sin perder el historial
-- de que la cuenta tuvo una suscripción (útil para reactivación/soporte).
-- NULL mientras nunca hubo una suscripción.
alter table profiles add column pro_status text;
alter table profiles add constraint profiles_pro_status_check
  check (pro_status is null or pro_status in ('active', 'canceled', 'past_due'));

alter table profiles add column pro_started_at timestamptz;
alter table profiles add column pro_expires_at timestamptz;

-- Identificadores del proveedor de pago -- para que un futuro webhook de
-- dLocal pueda encontrar a qué fila de `profiles` corresponde un evento de
-- suscripción. `pro_subscription_id` único cuando no es null: dos perfiles
-- nunca deberían compartir la misma suscripción externa.
alter table profiles add column pro_provider text;
alter table profiles add column pro_subscription_id text;
create unique index profiles_pro_subscription_id_idx on profiles (pro_subscription_id)
  where pro_subscription_id is not null;

-- ============================================================
-- Seguridad: el cliente autenticado NO puede escalar su propio plan.
-- El único GRANT UPDATE que existe sobre `profiles` para `authenticated`
-- lista columnas explícitas -- (username, avatar_emoji, bio), ver
-- init_schema.sql + profile_edit.sql -- y Postgres deniega cualquier
-- columna no listada ahí, con o sin RLS. plan/pro_status/pro_started_at/
-- pro_expires_at/pro_provider/pro_subscription_id NO se agregan a ese
-- GRANT acá, a propósito: ampliarlo sería exactamente la escalada FREE ->
-- PRO que hay que evitar. Solo service_role (Edge Functions/webhook) puede
-- escribir estas columnas.
-- ============================================================
