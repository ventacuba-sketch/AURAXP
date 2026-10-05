-- AURA LIVE V1 -- shows en vivo (minutos u horas, no clips de 8s). Video/
-- audio en tiempo real vive en LiveKit (fuera de esta base, ver
-- supabase/functions/livekit-token); Supabase solo guarda METADATA: quién
-- transmite, título, estado, comentarios persistentes, Aura Checks
-- puntuales y votaciones del público -- nunca el stream en sí
-- (NO Supabase Storage para video en vivo, NO frames en Postgres).
--
-- Mismo criterio de seguridad que Chat V2 (ver 20261003000000): el
-- cliente nunca decide su propio rol/identidad -- auth.uid() siempre,
-- RPCs SECURITY DEFINER con search_path vacío, grants mínimos, cero
-- INSERT/UPDATE directo de cliente en las tablas sensibles.
--
-- Aditivo puro: no se toca ninguna tabla/función de Chat V1/V2, Scan,
-- Challenge, Wallet ni Dashboard.

-- ============================================================
-- A) Autorización explícita para transmitir (punto 8 del pedido)
-- ============================================================
-- Flag propio, deliberadamente SEPARADO de profiles.is_admin (ese es
-- "puede ver el dashboard de analítica", un permiso completamente
-- distinto) -- allowlist manual para V1, nunca auto-concedible por el
-- cliente: sin GRANT UPDATE de esta columna para anon/authenticated en
-- ningún lado, se activa solo por SQL directo (service_role) hasta que
-- exista un flujo de aprobación real.
alter table public.profiles add column if not exists can_host_live boolean not null default false;

-- ============================================================
-- B) Salas
-- ============================================================
create table if not exists public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  -- Slug corto, opaco, url-friendly -- nunca contiene username/email/id
  -- real (ver generate_live_slug más abajo). Es lo que viaja en
  -- /live/:slug, pensado para compartirse en WhatsApp/TikTok/IG.
  slug text not null unique,
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'preparing' check (status in ('preparing', 'live', 'ended', 'cancelled')),
  -- 'public' es el único valor hoy -- columna preparada para una futura
  -- sala privada/solo-seguidores sin tener que migrar el esquema después.
  visibility text not null default 'public' check (visibility in ('public')),
  -- Nombre de sala en LiveKit -- generado server-side (nunca el slug
  -- directo, para no acoplar "cómo se comparte" con "cómo se identifica
  -- en el SFU"), opaco, sin PII.
  livekit_room_name text not null unique,
  comments_enabled boolean not null default true,
  reactions_enabled boolean not null default true,
  aura_checks_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  -- Pico real de espectadores -- lo reporta el host periódicamente desde
  -- Presence (ver report_live_peak_viewers), solo puede crecer
  -- (greatest()), nunca un número inventado ni decreciente.
  peak_viewers int not null default 0
);

create index if not exists live_rooms_status_idx on public.live_rooms (status, created_at desc);
create index if not exists live_rooms_host_idx on public.live_rooms (host_user_id, created_at desc);
-- Soporte directo de "EN VIVO AHORA" en el lobby del Chat (sección 15).
create index if not exists live_rooms_live_now_idx on public.live_rooms (started_at desc) where status = 'live';

alter table public.live_rooms enable row level security;

-- Pública por diseño -- un invitado debe poder descubrir y ver el LIVE
-- sin cuenta (punto 9), y una sala YA terminada también debe poder
-- consultarse para mostrar "Este LIVE terminó" (punto 16). Nunca se
-- expone nada sensible acá (ni tokens, ni api keys, ni datos privados de
-- otra tabla).
drop policy if exists "live_rooms_select_all" on public.live_rooms;
create policy "live_rooms_select_all" on public.live_rooms
  for select using (true);

grant select on public.live_rooms to anon, authenticated;
-- Sin INSERT/UPDATE/DELETE directo -- todo vía create_live_room/
-- start_live_room/end_live_room (SECURITY DEFINER), que son los únicos
-- que pueden verificar can_host_live y la propiedad real de la sala.

-- ============================================================
-- C) Comentarios -- persistentes, solo autenticados
-- ============================================================
create table if not exists public.live_comments (
  id uuid primary key default gen_random_uuid(),
  live_room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id) on delete set null,
  constraint live_comments_body_length check (char_length(body) >= 1 and char_length(body) <= 300)
);

create index if not exists live_comments_room_recent_idx
  on public.live_comments (live_room_id, created_at desc) where hidden_at is null;
create index if not exists live_comments_rate_idx on public.live_comments (user_id, created_at desc);

alter table public.live_comments enable row level security;

-- Lectura abierta (igual que chat_messages en V1: un invitado SÍ puede
-- leer comentarios, lo que no puede es escribir uno -- ver sección 9/14).
drop policy if exists "live_comments_select_visible" on public.live_comments;
create policy "live_comments_select_visible" on public.live_comments
  for select using (hidden_at is null);

grant select on public.live_comments to anon, authenticated;
-- Sin INSERT/UPDATE directo -- vía send_live_comment()/hide_live_comment().

-- ============================================================
-- C-bis) Reacciones -- rate limit REAL server-side (auditoría GPT
--    hallazgo #5: el throttle de 300ms que vivía solo en el cliente
--    (REACTION_THROTTLE_MS) NO es protección real -- cualquier script
--    puede saltarse el cliente y mandar un Broadcast directo, y
--    `senderId` lo manda el cliente, así que no es confiable. Esta tabla
--    es UNA fila por (sala, identidad) que se SOBRESCRIBE en cada
--    intento (upsert, nunca insert nuevo) -- el tamaño está acotado por
--    participantes activos reaccionando, no por cantidad de reacciones,
--    así que no genera la tormenta de inserts que sección 12 prohíbe.
--    Además de la RPC, se cierra el canal Broadcast en sí con "Realtime
--    Authorization" (políticas RLS sobre `realtime.messages`, canal
--    marcado `private: true` -- ver subscribeToLiveReactions/
--    sendLiveReaction más abajo en el código): esquema y comportamiento
--    por defecto CONFIRMADOS contra el código fuente real de
--    github.com/supabase/realtime (no documentación de terceros, no
--    supuestos) -- `realtime.messages(topic text, extension text,
--    payload jsonb, ...)`, RLS habilitada con CERO policies propias del
--    producto (default deny real, mismo criterio que cada tabla de este
--    proyecto con "RLS habilitada, cero policies"), y `realtime.send()`
--    insertando ahí mismo como función de un rol administrador que sí
--    puede escribir pese al default-deny. Solo se agrega acá una policy
--    de SELECT (recibir), acotada por `topic like 'live-reactions-%'` --
--    nunca una de INSERT, así que un `channel.send()` directo sobre un
--    canal `private: true` para ese topic sigue sin política que lo
--    permita.
--    LIMITACIÓN HONESTA QUE SIGUE DOCUMENTADA (ver docs/aura-live.md):
--    lo de arriba cierra el canal "autorizado" (`private: true`) que
--    usa nuestra propia app. Lo que este sandbox NO pudo verificar
--    (requiere un proyecto Supabase real con Realtime corriendo) es si
--    el protocolo Realtime del proyecto en uso todavía acepta, para el
--    mismo nombre de topic, una conexión que NUNCA declara
--    `private: true` y por lo tanto nunca pasa por `realtime.messages`
--    en absoluto (el relay "clásico" de Broadcast, anterior a esta
--    función, que no toca Postgres). Si ese modo clásico sigue
--    disponible en el servidor Realtime del proyecto, un script que lo
--    use explícitamente seguiría pudiendo mandar al mismo topic sin
--    pasar por el rate limit. Cerrar ESO por completo (si hiciera
--    falta) requeriría confirmarlo contra el proyecto real desplegado.
-- ============================================================
create table if not exists public.live_reaction_throttle (
  live_room_id uuid not null references public.live_rooms(id) on delete cascade,
  identity text not null,
  window_start timestamptz not null default now(),
  count int not null default 0,
  primary key (live_room_id, identity)
);

alter table public.live_reaction_throttle enable row level security;
-- RLS habilitada, CERO policies -- solo send_live_reaction() (SECURITY
-- DEFINER) la toca. Ningún cliente necesita verla ni mucho menos
-- escribirla directo (mismo criterio que live_webhook_events).

-- Nota de housekeeping (deliberadamente NO implementada en este MVP,
-- para no ampliar el alcance de esta corrección): filas de salas ya
-- 'ended' hace mucho tiempo se acumulan acá indefinidamente -- costo de
-- storage despreciable (una fila por participante que alguna vez
-- reaccionó), pero un futuro job de limpieza periódica (`delete from
-- live_reaction_throttle using live_rooms where live_rooms.id =
-- live_reaction_throttle.live_room_id and live_rooms.status = 'ended'
-- and live_rooms.ended_at < now() - interval '30 days'`) sería el lugar
-- natural para acotarlo si hace falta.

-- Realtime Authorization (ver nota larga arriba) -- SOLO una policy de
-- SELECT (recibir), acotada al patrón de topic que usa
-- subscribeToLiveReactions/sendLiveReaction. Deliberadamente sin ninguna
-- policy de INSERT/UPDATE/DELETE: el default-deny de RLS que ya trae
-- `realtime.messages` (confirmado contra el código fuente real, ver
-- arriba) sigue vigente para escrituras de cliente en este topic -- solo
-- `realtime.send()` (invocado desde send_live_reaction(), nunca
-- directo) puede insertar ahí.
--
-- Envuelto en `to_regclass(...) is not null` porque `realtime.messages`
-- es una tabla que trae la PLATAFORMA Supabase (extensión Realtime), no
-- algo que creen las migraciones de este proyecto -- en un Postgres
-- "pelado" (como el stub local usado para el replay de verificación de
-- este mismo PR) ese esquema no existe, y sin esta guarda la migración
-- completa fallaría ahí con "relation realtime.messages does not
-- exist". En cualquier proyecto Supabase real, `realtime.messages`
-- siempre existe, así que la condición es efectivamente siempre
-- verdadera ahí -- esto nunca deja la policy real sin crearse en
-- producción, solo evita romper un entorno de prueba que no tiene el
-- esquema de la plataforma.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "live_reactions_broadcast_select" on realtime.messages';
    execute $sql$
      create policy "live_reactions_broadcast_select" on realtime.messages
        for select
        to anon, authenticated
        using (realtime.messages.extension = 'broadcast' and realtime.messages.topic like 'live-reactions-%')
    $sql$;
  end if;
end
$$;

-- ============================================================
-- D) Aura Check -- puntual, nunca económico (punto 18)
-- ============================================================
create table if not exists public.live_aura_checks (
  id uuid primary key default gen_random_uuid(),
  live_room_id uuid not null references public.live_rooms(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  -- Path dentro del bucket privado `live-aura-checks` (ver sección E) --
  -- nunca expuesto directo al cliente (ver la vista pública más abajo),
  -- solo lo lee process-live-aura-check (service_role).
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  -- Resultado PRESENTACIONAL -- confidence/style/timing son los campos
  -- reales que ya devuelve Gemini (ver _shared/scoring.ts GeminiScores),
  -- nunca "presencia/originalidad" inventados sin soporte real en el
  -- pipeline. auraScore/verdictTag salen de computeAuraScore(), la MISMA
  -- función pura que usa process-scan -- sin volver a escribir lógica de
  -- scoring, y sin ningún efecto económico (ver process-live-aura-check:
  -- jamás toca profiles.xp, wallets, coin_transactions, daily_scan_counts
  -- ni scans).
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists live_aura_checks_room_idx on public.live_aura_checks (live_room_id, created_at desc);
-- Rate-limit de Aura Checks por sala (evita golpear Gemini en loop).
create index if not exists live_aura_checks_room_rate_idx on public.live_aura_checks (live_room_id, created_at desc);

alter table public.live_aura_checks enable row level security;

-- Lectura abierta -- a diferencia de chat_guest_rewards (una recompensa
-- reclamable real), nada en esta fila es sensible: storage_path es solo
-- una ruta dentro de un bucket privado (la protección real es la policy
-- de Storage de la sección E, no ocultar el string), y error_message es
-- diagnóstico interno sin PII. Exponerla directo (en vez de una vista
-- column-restricted) es lo que permite que Realtime Postgres Changes
-- funcione para TODOS los espectadores (sección 18: "el resultado
-- aparece como overlay temporal para todos los espectadores") -- RLS
-- aplica también a las suscripciones de Realtime, así que una tabla sin
-- ninguna policy de SELECT nunca entrega un evento a nadie.
drop policy if exists "live_aura_checks_select_all" on public.live_aura_checks;
create policy "live_aura_checks_select_all" on public.live_aura_checks
  for select using (true);

grant select on public.live_aura_checks to anon, authenticated;

-- Vista de conveniencia -- mismas columnas que el cliente realmente
-- necesita pintar el overlay, sin tener que repetir la lista de columnas
-- en cada query (chatService/liveService.ts la usa para el fetch
-- puntual; la suscripción de Realtime, en cambio, va sobre la tabla
-- base, Postgres Changes no admite vistas).
create or replace view public.live_aura_checks_public as
  select id, live_room_id, status, result, created_at, completed_at
  from public.live_aura_checks;

grant select on public.live_aura_checks_public to anon, authenticated;

-- ============================================================
-- E) Storage: bucket privado "live-aura-checks", carpeta = user_id
-- ============================================================
-- Mismo patrón exacto que el bucket "scans" (init_schema) -- privado,
-- RLS por carpeta = auth.uid(), nunca público.
insert into storage.buckets (id, name, public)
values ('live-aura-checks', 'live-aura-checks', false)
on conflict (id) do nothing;

drop policy if exists "live_aura_checks_bucket_insert_own" on storage.objects;
create policy "live_aura_checks_bucket_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'live-aura-checks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "live_aura_checks_bucket_select_own" on storage.objects;
create policy "live_aura_checks_bucket_select_own" on storage.objects
  for select using (
    bucket_id = 'live-aura-checks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- F) Votación del público (punto 20) -- "voto del público", nunca
--    resultado IA. V1 simple: A vs B, un voto por usuario por poll.
-- ============================================================
create table if not exists public.live_polls (
  id uuid primary key default gen_random_uuid(),
  live_room_id uuid not null references public.live_rooms(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  option_a_label text not null check (char_length(option_a_label) between 1 and 60),
  option_b_label text not null check (char_length(option_b_label) between 1 and 60),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz
);

create index if not exists live_polls_room_idx on public.live_polls (live_room_id, created_at desc);

alter table public.live_polls enable row level security;

drop policy if exists "live_polls_select_all" on public.live_polls;
create policy "live_polls_select_all" on public.live_polls
  for select using (true);

grant select on public.live_polls to anon, authenticated;

-- Boletas individuales -- RLS sin policies (mismo criterio que
-- chat_guest_rewards): nadie debería poder consultar "quién votó qué"
-- directo del cliente. Los conteos agregados se leen vía
-- get_live_poll_status() más abajo.
create table if not exists public.live_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.live_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option text not null check (option in ('a', 'b')),
  created_at timestamptz not null default now()
);

create unique index if not exists live_poll_votes_one_per_user on public.live_poll_votes (poll_id, user_id);

alter table public.live_poll_votes enable row level security;
-- Sin policies de cliente a propósito -- ver comentario arriba.

-- ============================================================
-- G) Reconciliación server-side (punto 35) -- eventos crudos de LiveKit
--    recibidos por el webhook, para no confiar solo en que el host
--    cliente llame end_live_room si desaparece.
-- ============================================================
create table if not exists public.live_webhook_events (
  id uuid primary key default gen_random_uuid(),
  -- `id` ÚNICO que manda LiveKit en cada entrega de webhook (campo `id`
  -- del WebhookEvent real del SDK oficial, sección "unique event uuid")
  -- -- LiveKit reintenta entregas que no confirman 200 a tiempo, así que
  -- sin esto un reintento auditaría/reconciliaría el mismo evento dos
  -- veces (auditoría GPT: "webhook idempotente"). Nullable porque el
  -- primer insert de auditoría ocurre ANTES de verificar la firma (sigue
  -- queriendo quedar logueado un intento con firma inválida, que nunca
  -- trae un id confiable).
  livekit_event_id text,
  event_type text not null,
  livekit_room_name text,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists live_webhook_events_livekit_event_id_key
  on public.live_webhook_events (livekit_event_id)
  where livekit_event_id is not null;

alter table public.live_webhook_events enable row level security;
-- RLS habilitada, CERO policies -- solo service_role (el webhook Edge
-- Function) escribe/lee acá. Ningún cliente debe ver eventos crudos de
-- infraestructura.

-- ============================================================
-- H) Realtime -- las tablas nuevas no se publican solas (mismo hallazgo
--    real que en Chat V2, ver 20261003000000).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_rooms'
  ) then
    alter publication supabase_realtime add table public.live_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_comments'
  ) then
    alter publication supabase_realtime add table public.live_comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_aura_checks'
  ) then
    alter publication supabase_realtime add table public.live_aura_checks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_polls'
  ) then
    alter publication supabase_realtime add table public.live_polls;
  end if;
end
$$;

-- ============================================================
-- I) RPCs
-- ============================================================

-- Slug corto (10 hex chars), opaco -- sin relación con username/email ni
-- con el id interno de la sala. Reintenta ante una colisión real
-- (extremadamente improbable con 5 bytes random, pero la unicidad de la
-- columna es la garantía real, no la probabilidad).
--
-- `search_path = public, extensions` (NO ''): gen_random_bytes() vive en
-- el esquema `extensions` en producción Supabase-hosted, no en `public`
-- -- causa real ya diagnosticada y corregida una vez en este proyecto
-- (ver 20260908000000_fix_search_path_pgcrypto.sql, "signup real roto en
-- producción"). Mismo fix, mismo criterio acá: agregar `extensions` al
-- search_path en vez de cualificar el nombre a mano, porque localmente
-- (Postgres vainilla, sin Supabase) pgcrypto puede terminar instalada en
-- `public` en cambio -- un prefijo fijo `extensions.` rompería ese
-- entorno de pruebas; con el search_path ampliado, Postgres encuentra la
-- función en cualquiera de los dos esquemas sin tocar el código.
create or replace function public.generate_live_slug()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(5), 'hex');
$$;

-- create_live_room: único camino para crear una sala. Exige
-- can_host_live=true server-side -- "imposible que el cliente se
-- conceda a sí mismo el permiso" (punto 7): esto solo LEE el flag, nunca
-- lo escribe, y ningún GRANT de UPDATE sobre esa columna existe para
-- anon/authenticated en ningún lado de esta migración.
create or replace function public.create_live_room(p_title text, p_description text default null)
returns table (ok boolean, room_id uuid, slug text, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_can_host boolean;
  v_title text;
  v_description text;
  v_id uuid;
  v_slug text;
  v_attempt int := 0;
begin
  if v_uid is null then
    return query select false, null::uuid, null::text, 'not_authenticated';
    return;
  end if;

  select p.can_host_live into v_can_host from public.profiles p where p.id = v_uid;
  if v_can_host is not true then
    return query select false, null::uuid, null::text, 'not_authorized';
    return;
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' or char_length(v_title) > 120 then
    return query select false, null::uuid, null::text, 'invalid_title';
    return;
  end if;
  v_description := nullif(btrim(coalesce(p_description, '')), '');
  if v_description is not null and char_length(v_description) > 500 then
    return query select false, null::uuid, null::text, 'invalid_description';
    return;
  end if;

  v_id := gen_random_uuid();

  loop
    v_slug := public.generate_live_slug();
    begin
      insert into public.live_rooms (id, slug, host_user_id, title, description, livekit_room_name)
      values (v_id, v_slug, v_uid, v_title, v_description, 'live_' || v_id::text);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then
        return query select false, null::uuid, null::text, 'slug_generation_failed';
        return;
      end if;
    end;
  end loop;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_created', v_uid, jsonb_build_object('live_room_id', v_id));
  exception when others then
    raise warning 'create_live_room: analytics failed for %: %', v_id, sqlerrm;
  end;

  return query select true, v_id, v_slug, null::text;
end;
$$;

revoke all on function public.create_live_room(text, text) from public, anon, authenticated;
grant execute on function public.create_live_room(text, text) to authenticated;

-- start_live_room: SOLO el host, y SOLO desde 'preparing'. Idempotente
-- ante un reintento (ya 'live' -> ok sin re-setear started_at).
create or replace function public.start_live_room(p_room_id uuid)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select * into v_room from public.live_rooms where id = p_room_id for update;
  if not found then
    return query select false, 'not_found';
    return;
  end if;
  if v_room.host_user_id <> v_uid then
    return query select false, 'not_authorized';
    return;
  end if;
  if v_room.status = 'live' then
    return query select true, null::text;
    return;
  end if;
  if v_room.status <> 'preparing' then
    return query select false, 'invalid_state';
    return;
  end if;

  update public.live_rooms set status = 'live', started_at = now() where id = p_room_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_started', v_uid, jsonb_build_object('live_room_id', p_room_id));
  exception when others then
    raise warning 'start_live_room: analytics failed for %: %', p_room_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.start_live_room(uuid) from public, anon, authenticated;
grant execute on function public.start_live_room(uuid) to authenticated;

-- end_live_room: host (desde el cliente) O reconciliación server-side
-- (el webhook, que corre como service_role y por lo tanto nunca pasa por
-- este RPC con RLS -- actualiza la tabla directo, ver
-- supabase/functions/livekit-webhook). Esta función cubre el camino
-- "el host todavía está conectado y toca Terminar".
create or replace function public.end_live_room(p_room_id uuid)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select * into v_room from public.live_rooms where id = p_room_id for update;
  if not found then
    return query select false, 'not_found';
    return;
  end if;
  if v_room.host_user_id <> v_uid then
    return query select false, 'not_authorized';
    return;
  end if;
  if v_room.status = 'ended' then
    return query select true, null::text;
    return;
  end if;

  update public.live_rooms set status = 'ended', ended_at = now() where id = p_room_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values (
      'live_ended', v_uid,
      jsonb_build_object(
        'live_room_id', p_room_id,
        'duration_seconds', case when v_room.started_at is not null then extract(epoch from (now() - v_room.started_at))::int else null end
      )
    );
  exception when others then
    raise warning 'end_live_room: analytics failed for %: %', p_room_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.end_live_room(uuid) from public, anon, authenticated;
grant execute on function public.end_live_room(uuid) to authenticated;

-- report_live_peak_viewers: host-only, best-effort (llamado cada ~15-30s
-- desde el cliente con el conteo real de Presence) -- greatest() asegura
-- que nunca retroceda, nunca inventa un número mayor al reportado.
create or replace function public.report_live_peak_viewers(p_room_id uuid, p_count int)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
begin
  if v_uid is null or p_count is null or p_count < 0 then
    return query select false;
    return;
  end if;

  select * into v_room from public.live_rooms where id = p_room_id;
  if not found or v_room.host_user_id <> v_uid then
    return query select false;
    return;
  end if;

  update public.live_rooms set peak_viewers = greatest(peak_viewers, p_count) where id = p_room_id;
  return query select true;
end;
$$;

revoke all on function public.report_live_peak_viewers(uuid, int) from public, anon, authenticated;
grant execute on function public.report_live_peak_viewers(uuid, int) to authenticated;

-- send_live_comment: único camino para comentar -- auth.uid() siempre,
-- nunca user_id de cliente. Rate limit igual presupuesto que Chat V1/V2
-- (máx 5 cada 10s). Exige sala 'live' y comments_enabled.
create or replace function public.send_live_comment(p_room_id uuid, p_body text)
returns table (id uuid, created_at timestamptz, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text;
  v_room public.live_rooms%rowtype;
  v_recent_count int;
  v_id uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    return query select null::uuid, null::timestamptz, 'not_authenticated';
    return;
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' or char_length(v_body) > 300 then
    return query select null::uuid, null::timestamptz, 'invalid_body';
    return;
  end if;

  -- `id` calificado con el nombre de tabla: esta función RETURNS
  -- TABLE(id, ...), así que "id" a secas acá adentro es ambiguo entre esa
  -- columna de salida y live_rooms.id (mismo bug real que `id` en
  -- send_private_message de Chat V2 y `created_at` en send_chat_message
  -- de Chat V1 -- encontrado ejecutando esto de verdad contra Postgres,
  -- ni tsc ni el build lo detectan).
  select * into v_room from public.live_rooms where live_rooms.id = p_room_id;
  if not found then
    return query select null::uuid, null::timestamptz, 'not_found';
    return;
  end if;
  if v_room.status <> 'live' then
    return query select null::uuid, null::timestamptz, 'not_live';
    return;
  end if;
  if not v_room.comments_enabled then
    return query select null::uuid, null::timestamptz, 'comments_disabled';
    return;
  end if;

  select count(*) into v_recent_count
  from public.live_comments c
  where c.user_id = v_uid and c.created_at > now() - interval '10 seconds';
  if v_recent_count >= 5 then
    return query select null::uuid, null::timestamptz, 'rate_limited';
    return;
  end if;

  insert into public.live_comments (live_room_id, user_id, body)
  values (p_room_id, v_uid, v_body)
  returning public.live_comments.id, public.live_comments.created_at into v_id, v_created_at;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_comment_sent', v_uid, jsonb_build_object('live_room_id', p_room_id));
  exception when others then
    raise warning 'send_live_comment: analytics failed for %: %', v_id, sqlerrm;
  end;

  return query select v_id, v_created_at, null::text;
end;
$$;

revoke all on function public.send_live_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.send_live_comment(uuid, text) to authenticated;

-- hide_live_comment: el host de ESA sala, o un admin global
-- (profiles.is_admin, mismo flag que Chat V1) -- nunca un sistema de
-- moderación paralelo.
create or replace function public.hide_live_comment(p_comment_id uuid)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment public.live_comments%rowtype;
  v_room public.live_rooms%rowtype;
  v_is_admin boolean;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select * into v_comment from public.live_comments where id = p_comment_id;
  if not found then
    return query select false, 'not_found';
    return;
  end if;

  select * into v_room from public.live_rooms where id = v_comment.live_room_id;
  select p.is_admin into v_is_admin from public.profiles p where p.id = v_uid;

  if v_room.host_user_id <> v_uid and v_is_admin is not true then
    return query select false, 'not_authorized';
    return;
  end if;

  update public.live_comments set hidden_at = now(), hidden_by = v_uid where id = p_comment_id;
  return query select true, null::text;
end;
$$;

revoke all on function public.hide_live_comment(uuid) from public, anon, authenticated;
grant execute on function public.hide_live_comment(uuid) to authenticated;

-- send_live_reaction: ÚNICO camino que usa el cliente de AURA VS para
-- mandar una reacción (auditoría GPT hallazgo #5) -- identidad SIEMPRE
-- resuelta server-side (auth.uid() si hay sesión, invitado solo si
-- p_guest_id tiene forma válida -- mismo criterio que livekit-token),
-- NUNCA un senderId que mande el cliente. Rate limit real vía upsert
-- sobre live_reaction_throttle (ver esa tabla arriba): máx 6 reacciones
-- cada 3 segundos por (sala, identidad). Emite el Broadcast real desde
-- la base vía `realtime.send()` (función de Supabase para "Broadcast
-- from Database", `private := true` para que pase por la policy de
-- Realtime Authorization de arriba) -- si esa función no está
-- disponible o falla, la reacción NUNCA debe tumbar el rate limit ya
-- aplicado (ver bloque exception abajo); en el peor caso, simplemente
-- no aparece en otros dispositivos, nunca un error 500 para el usuario
-- que reaccionó.
create or replace function public.send_live_reaction(p_room_id uuid, p_emoji text, p_guest_id text default null)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_identity text;
  v_room public.live_rooms%rowtype;
  v_now timestamptz := now();
  v_window_seconds constant int := 3;
  v_max_per_window constant int := 6;
  v_count int;
begin
  if p_emoji is null or p_emoji not in ('🔥', '⚡', '❤️') then
    return query select false, 'invalid_emoji';
    return;
  end if;

  if v_uid is not null then
    v_identity := 'user:' || v_uid::text;
  else
    if p_guest_id is null or length(p_guest_id) < 8 or length(p_guest_id) > 200 then
      return query select false, 'guest_id_required';
      return;
    end if;
    v_identity := 'guest:' || p_guest_id;
  end if;

  select * into v_room from public.live_rooms where live_rooms.id = p_room_id;
  if not found or v_room.status <> 'live' or not v_room.reactions_enabled then
    return query select false, 'room_not_live';
    return;
  end if;

  insert into public.live_reaction_throttle as t (live_room_id, identity, window_start, count)
  values (p_room_id, v_identity, v_now, 1)
  on conflict (live_room_id, identity) do update
    set window_start = case when t.window_start < v_now - make_interval(secs => v_window_seconds) then v_now else t.window_start end,
        count = case when t.window_start < v_now - make_interval(secs => v_window_seconds) then 1 else t.count + 1 end
  returning t.count into v_count;

  if v_count > v_max_per_window then
    return query select false, 'rate_limited';
    return;
  end if;

  begin
    perform realtime.send(jsonb_build_object('emoji', p_emoji), 'reaction', 'live-reactions-' || p_room_id::text, true);
  exception when others then
    raise warning 'send_live_reaction: realtime.send failed for room %: %', p_room_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.send_live_reaction(uuid, text, text) from public;
grant execute on function public.send_live_reaction(uuid, text, text) to anon, authenticated;

-- request_live_aura_check: host-only para V1 (evita que cualquier
-- espectador dispare llamadas a Gemini a discreción -- control de costo,
-- punto 27). Rate-limit server-side: máx 1 Aura Check cada 30s por sala.
-- Solo CREA la fila 'pending' -- el procesamiento real (Gemini) corre
-- en process-live-aura-check (Edge Function, service_role), nunca acá.
create or replace function public.request_live_aura_check(p_room_id uuid, p_storage_path text)
returns table (ok boolean, check_id uuid, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
  v_recent_count int;
  v_id uuid;
begin
  if v_uid is null then
    return query select false, null::uuid, 'not_authenticated';
    return;
  end if;

  select * into v_room from public.live_rooms where id = p_room_id;
  if not found then
    return query select false, null::uuid, 'not_found';
    return;
  end if;
  if v_room.host_user_id <> v_uid then
    return query select false, null::uuid, 'not_authorized';
    return;
  end if;
  if v_room.status <> 'live' then
    return query select false, null::uuid, 'not_live';
    return;
  end if;
  if not v_room.aura_checks_enabled then
    return query select false, null::uuid, 'aura_checks_disabled';
    return;
  end if;
  -- El path SIEMPRE debe vivir bajo la carpeta del propio host, aunque
  -- la policy de Storage ya lo garantice al mintear la signed URL --
  -- defensa en profundidad, mismo criterio que process-scan.
  if p_storage_path is null or p_storage_path !~ ('^' || v_uid::text || '/') then
    return query select false, null::uuid, 'invalid_path';
    return;
  end if;

  select count(*) into v_recent_count
  from public.live_aura_checks c
  where c.live_room_id = p_room_id and c.created_at > now() - interval '30 seconds';
  if v_recent_count >= 1 then
    return query select false, null::uuid, 'rate_limited';
    return;
  end if;

  insert into public.live_aura_checks (live_room_id, requested_by, storage_path)
  values (p_room_id, v_uid, p_storage_path)
  returning id into v_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_aura_check_started', v_uid, jsonb_build_object('live_room_id', p_room_id, 'check_id', v_id));
  exception when others then
    raise warning 'request_live_aura_check: analytics failed for %: %', v_id, sqlerrm;
  end;

  return query select true, v_id, null::text;
end;
$$;

revoke all on function public.request_live_aura_check(uuid, text) from public, anon, authenticated;
grant execute on function public.request_live_aura_check(uuid, text) to authenticated;

-- create_live_poll: host-only. Duración clamped 30-60s (punto 20).
create or replace function public.create_live_poll(p_room_id uuid, p_option_a text, p_option_b text, p_duration_seconds int default 45)
returns table (ok boolean, poll_id uuid, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
  v_a text;
  v_b text;
  v_duration int;
  v_id uuid;
begin
  if v_uid is null then
    return query select false, null::uuid, 'not_authenticated';
    return;
  end if;

  select * into v_room from public.live_rooms where id = p_room_id;
  if not found then
    return query select false, null::uuid, 'not_found';
    return;
  end if;
  if v_room.host_user_id <> v_uid then
    return query select false, null::uuid, 'not_authorized';
    return;
  end if;
  if v_room.status <> 'live' then
    return query select false, null::uuid, 'not_live';
    return;
  end if;

  v_a := btrim(coalesce(p_option_a, ''));
  v_b := btrim(coalesce(p_option_b, ''));
  if v_a = '' or v_b = '' or char_length(v_a) > 60 or char_length(v_b) > 60 then
    return query select false, null::uuid, 'invalid_options';
    return;
  end if;

  v_duration := greatest(30, least(60, coalesce(p_duration_seconds, 45)));

  -- Un solo poll activo por sala a la vez -- cierra cualquier otro antes
  -- de abrir uno nuevo (evita confundir "voto del público" de dos
  -- duelos distintos al mismo tiempo).
  update public.live_polls set status = 'closed', closed_at = now()
    where live_room_id = p_room_id and status = 'active';

  insert into public.live_polls (live_room_id, created_by, option_a_label, option_b_label, closes_at)
  values (p_room_id, v_uid, v_a, v_b, now() + make_interval(secs => v_duration))
  returning id into v_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_poll_started', v_uid, jsonb_build_object('live_room_id', p_room_id, 'poll_id', v_id));
  exception when others then
    raise warning 'create_live_poll: analytics failed for %: %', v_id, sqlerrm;
  end;

  return query select true, v_id, null::text;
end;
$$;

revoke all on function public.create_live_poll(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.create_live_poll(uuid, text, text, int) to authenticated;

-- vote_live_poll: un voto por usuario por poll (índice único), solo
-- mientras está realmente activo y no vencido.
create or replace function public.vote_live_poll(p_poll_id uuid, p_option text)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.live_polls%rowtype;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;
  if p_option not in ('a', 'b') then
    return query select false, 'invalid_option';
    return;
  end if;

  select * into v_poll from public.live_polls where id = p_poll_id;
  if not found then
    return query select false, 'not_found';
    return;
  end if;
  if v_poll.status <> 'active' or v_poll.closes_at <= now() then
    return query select false, 'poll_closed';
    return;
  end if;

  begin
    insert into public.live_poll_votes (poll_id, user_id, option) values (p_poll_id, v_uid, p_option);
  exception when unique_violation then
    return query select false, 'already_voted';
    return;
  end;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('live_vote_cast', v_uid, jsonb_build_object('poll_id', p_poll_id, 'option', p_option));
  exception when others then
    raise warning 'vote_live_poll: analytics failed for %: %', p_poll_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.vote_live_poll(uuid, text) from public, anon, authenticated;
grant execute on function public.vote_live_poll(uuid, text) to authenticated;

-- get_live_poll_status: conteos agregados + "¿ya voté?" -- nunca expone
-- boletas individuales de otros (live_poll_votes no tiene policies de
-- cliente, ver arriba). `stable` + `security definer` para poder leer
-- la tabla sin policies desde acá sin ampliar su RLS real.
create or replace function public.get_live_poll_status(p_poll_id uuid)
returns table (option_a_count bigint, option_b_count bigint, my_vote text, is_active boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.live_polls%rowtype;
begin
  select * into v_poll from public.live_polls where id = p_poll_id;
  if not found then
    return;
  end if;

  return query
    select
      (select count(*) from public.live_poll_votes v where v.poll_id = p_poll_id and v.option = 'a'),
      (select count(*) from public.live_poll_votes v where v.poll_id = p_poll_id and v.option = 'b'),
      (select v.option from public.live_poll_votes v where v.poll_id = p_poll_id and v.user_id = v_uid),
      (v_poll.status = 'active' and v_poll.closes_at > now());
end;
$$;

revoke all on function public.get_live_poll_status(uuid) from public, anon, authenticated;
grant execute on function public.get_live_poll_status(uuid) to anon, authenticated;

-- close_live_poll: cierre explícito opcional del host (si no, el poll
-- simplemente deja de aceptar votos solo al pasar closes_at -- ver
-- vote_live_poll/get_live_poll_status, ninguno de los dos necesita esto
-- para funcionar bien).
create or replace function public.close_live_poll(p_poll_id uuid)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.live_polls%rowtype;
  v_room public.live_rooms%rowtype;
begin
  if v_uid is null then
    return query select false;
    return;
  end if;

  select * into v_poll from public.live_polls where id = p_poll_id;
  if not found then
    return query select false;
    return;
  end if;
  select * into v_room from public.live_rooms where id = v_poll.live_room_id;
  if v_room.host_user_id <> v_uid then
    return query select false;
    return;
  end if;

  update public.live_polls set status = 'closed', closed_at = now() where id = p_poll_id and status = 'active';
  return query select true;
end;
$$;

revoke all on function public.close_live_poll(uuid) from public, anon, authenticated;
grant execute on function public.close_live_poll(uuid) to authenticated;
