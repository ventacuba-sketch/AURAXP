-- CHAT V2 -- "Sala Social": integrantes (presencia real vía Realtime
-- Presence, sin backend nuevo) + mensajes privados CON CONSENTIMIENTO +
-- arquitectura mínima de bloqueo.
--
-- Auditado primero (ver reporte de esta tarea): no se toca NADA de Chat
-- V1 (chat_messages/chat_reactions/chat_guest_rewards/send_chat_message/
-- toggle_chat_reaction/set_chat_status/hide_chat_message/
-- ensure_chat_guest_reward/get_chat_guest_reward_status/
-- claim_chat_guest_reward) -- sala global, invitados, reacciones, reward
-- de 200 Coins, rate limiting, moderación y analytics de V1 siguen
-- funcionando exactamente igual. Todo lo nuevo son 4 tablas + funciones +
-- 1 vista, puramente aditivo.
--
-- REGLA FUNDAMENTAL (privados): nadie puede escribirle en privado a
-- nadie sin que la otra persona acepte explícitamente -- ver
-- chat_private_requests/request_private_chat/respond_private_chat_request
-- abajo. Ningún INSERT/UPDATE directo de cliente en ninguna tabla nueva:
-- todo pasa por RPCs SECURITY DEFINER que resuelven identidad vía
-- auth.uid() (nunca un user_id que mande el cliente) -- mismo patrón ya
-- usado en toda la base (apply_coin_transaction, send_chat_message, etc).
--
-- Presencia: implementada 100% client-side con Supabase Realtime
-- Presence (un canal, sin tabla nueva) -- ver chatPresenceService.ts. Acá
-- solo se prepara lo que SQL puede ofrecer de verdad: last_aura_score
-- real (sin recalcular nada) para la lista de integrantes.

-- ============================================================
-- A) Solicitudes de chat privado
-- ============================================================
-- Diseño append-only (igual criterio que chat_messages/analytics_events:
-- nunca se reescribe una fila pasada, cada intento real es una fila
-- nueva) -- requester/recipient son auth.uid()/el perfil resuelto por
-- username server-side, NUNCA un id que mande el cliente.
create table if not exists public.chat_private_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  -- Columnas generadas (par sin importar dirección) -- la unicidad de
  -- abajo usa ESTAS, no (requester_id, recipient_id), para que A->B y
  -- B->A cuenten como el mismo par y no puedan coexistir dos pendientes
  -- a la vez (punto 7 del pedido: "evitar solicitudes duplicadas").
  user_lo uuid generated always as (least(requester_id, recipient_id)) stored,
  user_hi uuid generated always as (greatest(requester_id, recipient_id)) stored,
  constraint chat_private_requests_no_self check (requester_id <> recipient_id)
);

-- Como mucho UNA solicitud pendiente por par, sin importar quién la
-- mandó -- bloquea duplicados A->B/B->A a nivel de base de datos (nunca
-- solo de aplicación), incluso bajo dos inserts concurrentes (el segundo
-- revienta con unique_violation, capturado abajo en request_private_chat
-- y traducido a 'already_requested', nunca una solicitud fantasma).
create unique index if not exists chat_private_requests_one_pending_pair
  on public.chat_private_requests (user_lo, user_hi)
  where status = 'pending';

create index if not exists chat_private_requests_recipient_idx
  on public.chat_private_requests (recipient_id, created_at desc);
create index if not exists chat_private_requests_requester_idx
  on public.chat_private_requests (requester_id, created_at desc);
-- Soporte directo del cooldown post-rechazo (ver request_private_chat):
-- "la última solicitud de ESTE requester hacia ESTE recipient".
create index if not exists chat_private_requests_pair_direction_idx
  on public.chat_private_requests (requester_id, recipient_id, created_at desc);

alter table public.chat_private_requests enable row level security;

-- Cada quien ve SOLO las solicitudes donde participa (como requester o
-- como recipient) -- ni una fila ajena, ni para anon (auth.uid() es null
-- para un invitado, así que la condición nunca matchea ninguna fila:
-- "ningún acceso de invitados a tablas privadas", punto 7).
drop policy if exists "chat_private_requests_select_involved" on public.chat_private_requests;
create policy "chat_private_requests_select_involved" on public.chat_private_requests
  for select using (auth.uid() = requester_id or auth.uid() = recipient_id);

grant select on public.chat_private_requests to authenticated;
-- Sin INSERT/UPDATE para nadie -- todo vía request_private_chat()/
-- respond_private_chat_request() (SECURITY DEFINER), igual criterio que
-- chat_messages en V1.

-- ============================================================
-- B) Conversaciones privadas 1:1
-- ============================================================
-- user_a/user_b SIEMPRE normalizados (a = el menor uuid) -- el check +
-- el índice único de abajo garantizan, a nivel de base de datos, que
-- jamás pueda existir una fila A-B Y otra B-A para el mismo par (punto 7:
-- "evitar duplicar conversación A-B / B-A"), sin depender de que la
-- aplicación nunca tenga un bug.
create table if not exists public.chat_private_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.chat_private_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Marcadores de lectura por lado -- evita una tabla aparte solo para
  -- "hasta cuándo leyó cada quien" (son exactamente 2 valores por fila).
  last_read_at_a timestamptz,
  last_read_at_b timestamptz,
  -- Bloqueo (punto 8): oculta la conversación de la bandeja de quien
  -- bloqueó, SIN tocar ni un mensaje histórico (nunca se borra nada acá).
  hidden_by_a boolean not null default false,
  hidden_by_b boolean not null default false,
  constraint chat_private_conversations_distinct check (user_a <> user_b),
  constraint chat_private_conversations_order check (user_a < user_b)
);

create unique index if not exists chat_private_conversations_pair_unique
  on public.chat_private_conversations (user_a, user_b);
create index if not exists chat_private_conversations_user_a_idx
  on public.chat_private_conversations (user_a, last_message_at desc);
create index if not exists chat_private_conversations_user_b_idx
  on public.chat_private_conversations (user_b, last_message_at desc);

alter table public.chat_private_conversations enable row level security;

drop policy if exists "chat_private_conversations_select_involved" on public.chat_private_conversations;
create policy "chat_private_conversations_select_involved" on public.chat_private_conversations
  for select using (auth.uid() = user_a or auth.uid() = user_b);

grant select on public.chat_private_conversations to authenticated;
-- Sin INSERT/UPDATE directo -- se crea únicamente como efecto de aceptar
-- una solicitud real (respond_private_chat_request), nunca por un
-- insert del cliente.

-- ============================================================
-- C) Mensajes privados
-- ============================================================
create table if not exists public.chat_private_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_private_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  constraint chat_private_messages_body_length check (char_length(body) >= 1 and char_length(body) <= 300)
);

create index if not exists chat_private_messages_conversation_idx
  on public.chat_private_messages (conversation_id, created_at desc) where hidden_at is null;
-- Soporte del rate-limit de send_private_message (mismo criterio que
-- chat_messages_rate_user_idx en V1, pero acá es GLOBAL por remitente a
-- través de TODAS sus conversaciones privadas, no por conversación --
-- evita que alguien evada el rate-limit abriendo muchas conversaciones).
create index if not exists chat_private_messages_sender_rate_idx
  on public.chat_private_messages (sender_id, created_at desc);

alter table public.chat_private_messages enable row level security;

-- Solo quienes participan en la conversación (y el mensaje no está
-- oculto) -- un tercero (C) nunca puede leer una conversación ajena, ni
-- siquiera sabiendo el id (punto 7: "usuario C no puede leer conversación
-- A-B"). Un invitado (auth.uid() null) nunca matchea el EXISTS de abajo.
drop policy if exists "chat_private_messages_select_involved" on public.chat_private_messages;
create policy "chat_private_messages_select_involved" on public.chat_private_messages
  for select using (
    hidden_at is null
    and exists (
      select 1 from public.chat_private_conversations c
      where c.id = chat_private_messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

grant select on public.chat_private_messages to authenticated;

-- Realtime Postgres Changes NO publica tablas nuevas automáticamente.
-- Sin esto, el fallback HTTP funciona pero los mensajes/solicitudes de
-- otros usuarios no aparecen en vivo. Guardado para que el replay siga
-- siendo idempotente si la tabla ya fue añadida a la publicación.
do $
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_private_messages'
  ) then
    alter publication supabase_realtime add table public.chat_private_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_private_requests'
  ) then
    alter publication supabase_realtime add table public.chat_private_requests;
  end if;
end
$;

-- Sin INSERT directo -- todo vía send_private_message() (SECURITY
-- DEFINER): ahí es donde vive la validación real de longitud, rate
-- limit, pertenencia a la conversación y bloqueo -- "no confiar en
-- user_id enviado por cliente: usar auth.uid()" (punto 7) se cumple acá
-- literalmente, sender_id SIEMPRE sale de auth.uid() dentro del RPC.

-- ============================================================
-- D) Bloqueo (arquitectura mínima, punto 8 -- implementado ya, no solo
--    dejado preparado: el pedido explícitamente prefiere esto)
-- ============================================================
create table if not exists public.chat_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_blocks_no_self check (blocker_id <> blocked_id)
);

create unique index if not exists chat_blocks_pair_unique on public.chat_blocks (blocker_id, blocked_id);
create index if not exists chat_blocks_blocked_idx on public.chat_blocks (blocked_id);

alter table public.chat_blocks enable row level security;

-- Solo quien bloqueó ve su propia lista de bloqueados -- a quien bloquea
-- no se le expone "quién lo bloqueó a él" (RLS no da SELECT en ninguna
-- dirección salvo la propia como blocker).
drop policy if exists "chat_blocks_select_own" on public.chat_blocks;
create policy "chat_blocks_select_own" on public.chat_blocks
  for select using (auth.uid() = blocker_id);

grant select on public.chat_blocks to authenticated;
-- Sin INSERT/DELETE directo -- vía block_user() (SECURITY DEFINER).

-- ============================================================
-- E) Perfil de integrante -- Aura reciente REAL, nunca recalculada
-- ============================================================
-- Vista separada de chat_public_profiles (V1): esta además resuelve el
-- último Scan 'done' de cada usuario (si existe) para mostrar su Aura
-- reciente en el panel de Integrantes -- SOLO lectura del valor ya
-- calculado por process-scan, jamás una fórmula nueva (punto 3: "NO
-- recalcular Aura. NO alterar XP. NO alterar economía."). Igual
-- principio que chat_public_profiles: la vista corre con los privilegios
-- de quien la crea, exponiendo columnas puntuales sin ampliar la RLS real
-- de `profiles`/`scans`.
create or replace view public.chat_member_profiles as
  select
    p.id,
    p.username,
    p.avatar_emoji,
    p.level,
    p.chat_status,
    (
      select s.aura_score
      from public.scans s
      where s.user_id = p.id and s.status = 'done' and s.aura_score is not null
      order by s.created_at desc
      limit 1
    ) as last_aura_score
  from public.profiles p;

grant select on public.chat_member_profiles to anon, authenticated;

-- ============================================================
-- F) RPCs -- solicitudes privadas
-- ============================================================

-- Cooldown tras un rechazo -- "razonable": 24 horas antes de poder volver
-- a pedirle chat privado a la MISMA persona que te rechazó.
-- request_private_chat: único camino para crear una solicitud. Resuelve
-- el requester real vía auth.uid() (nunca lo que mande el cliente),
-- busca al target por username (igual patrón que follow_user/
-- create_direct_challenge), bloquea auto-solicitud, bloqueo mutuo,
-- duplicados y rate-limit básico.
create or replace function public.request_private_chat(p_target_username text)
returns table (ok boolean, request_id uuid, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target_id uuid;
  v_recent_count int;
  v_last_rejected public.chat_private_requests%rowtype;
  v_existing_pending public.chat_private_requests%rowtype;
  v_new_id uuid;
begin
  if v_uid is null then
    return query select false, null::uuid, 'not_authenticated';
    return;
  end if;

  select p.id into v_target_id from public.profiles p where p.username = p_target_username;
  if v_target_id is null then
    return query select false, null::uuid, 'target_not_found';
    return;
  end if;

  if v_target_id = v_uid then
    return query select false, null::uuid, 'cannot_request_self';
    return;
  end if;

  -- Bloqueo en cualquier dirección -- ni A puede pedirle a B que lo
  -- bloqueó, ni A puede pedirle a alguien que A mismo bloqueó.
  if exists (
    select 1 from public.chat_blocks b
    where (b.blocker_id = v_uid and b.blocked_id = v_target_id)
       or (b.blocker_id = v_target_id and b.blocked_id = v_uid)
  ) then
    return query select false, null::uuid, 'blocked';
    return;
  end if;

  -- Rate limit básico -- máx 5 solicitudes nuevas cada 60 segundos (evita
  -- spamear solicitudes a medio room).
  select count(*) into v_recent_count
  from public.chat_private_requests r
  where r.requester_id = v_uid and r.created_at > now() - interval '60 seconds';
  if v_recent_count >= 5 then
    return query select false, null::uuid, 'rate_limited';
    return;
  end if;

  -- ¿Ya hay una pendiente entre este par (en cualquier dirección)? Si la
  -- pendiente existente me tiene como RECIPIENT, se lo decimos al cliente
  -- (debería ir a responder esa, no mandar una nueva) en vez de un error
  -- genérico.
  select * into v_existing_pending
  from public.chat_private_requests r
  where r.status = 'pending' and least(r.requester_id, r.recipient_id) = least(v_uid, v_target_id)
    and greatest(r.requester_id, r.recipient_id) = greatest(v_uid, v_target_id);
  if found then
    if v_existing_pending.recipient_id = v_uid then
      return query select false, v_existing_pending.id, 'pending_incoming_exists';
    else
      return query select false, v_existing_pending.id, 'already_requested';
    end if;
    return;
  end if;

  -- Cooldown: la última vez que YO le pedí a ESTA persona, ¿terminó
  -- rechazada hace menos de 24hs?
  select * into v_last_rejected
  from public.chat_private_requests r
  where r.requester_id = v_uid and r.recipient_id = v_target_id and r.status = 'rejected'
  order by r.responded_at desc nulls last
  limit 1;
  if found and v_last_rejected.responded_at is not null and v_last_rejected.responded_at > now() - interval '24 hours' then
    return query select false, null::uuid, 'cooldown';
    return;
  end if;

  begin
    insert into public.chat_private_requests (requester_id, recipient_id)
    values (v_uid, v_target_id)
    returning id into v_new_id;
  exception when unique_violation then
    -- Carrera real: dos inserts concurrentes para el mismo par (ver
    -- pruebas de esta tarea) -- el índice único parcial es la garantía de
    -- verdad, esto solo traduce la excepción a un error legible en vez de
    -- un 500 crudo.
    return query select false, null::uuid, 'already_requested';
    return;
  end;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_private_requested', v_uid, jsonb_build_object('target_user_id', v_target_id));
  exception when others then
    raise warning 'request_private_chat: analytics failed for %: %', v_new_id, sqlerrm;
  end;

  -- Notificación real -- reusa el ÚNICO choke point de Push que ya existe
  -- (trigger AFTER INSERT en notifications, ver 20260904000000): ningún
  -- sistema de Push nuevo, ningún Edge Function nuevo.
  begin
    insert into public.notifications (user_id, kind, rival_user_id)
    values (v_target_id, 'chat_private_request', v_uid);
  exception when others then
    raise warning 'request_private_chat: notification failed for %: %', v_new_id, sqlerrm;
  end;

  return query select true, v_new_id, null::text;
end;
$$;

revoke all on function public.request_private_chat(text) from public, anon, authenticated;
grant execute on function public.request_private_chat(text) to authenticated;

-- respond_private_chat_request: único camino para aceptar/rechazar. El
-- lock FOR UPDATE sobre la fila de la solicitud ANTES de revisar su
-- estado es lo que evita una doble-aceptación concurrente (punto 7:
-- "evitar doble aceptación concurrente") -- mismo patrón ya probado en
-- claim_chat_guest_reward (V1): la segunda llamada concurrente queda
-- bloqueada hasta que la primera commitea, y para cuando puede seguir ya
-- ve el status actualizado (ya no 'pending'), así que responde
-- 'already_responded' en vez de crear una segunda conversación o
-- reprocesar el aceptar/rechazar.
create or replace function public.respond_private_chat_request(p_request_id uuid, p_accept boolean)
returns table (ok boolean, conversation_id uuid, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_req public.chat_private_requests%rowtype;
  v_conv_id uuid;
  v_lo uuid;
  v_hi uuid;
begin
  if v_uid is null then
    return query select false, null::uuid, 'not_authenticated';
    return;
  end if;

  select * into v_req from public.chat_private_requests where id = p_request_id for update;
  if not found then
    return query select false, null::uuid, 'not_found';
    return;
  end if;

  if v_req.recipient_id <> v_uid then
    return query select false, null::uuid, 'not_authorized';
    return;
  end if;

  if v_req.status <> 'pending' then
    -- Ya resuelta (por mí mismo en un reintento, o -- el caso que
    -- realmente importa -- por una llamada concurrente que ganó el lock
    -- primero). Nunca crea una segunda conversación.
    return query select (v_req.status = 'accepted'), null::uuid, 'already_responded';
    return;
  end if;

  -- Si cualquiera bloqueó al otro después de que se creó la solicitud,
  -- una solicitud vieja no puede usarse para saltarse el bloqueo.
  if exists (
    select 1 from public.chat_blocks b
    where (b.blocker_id = v_req.requester_id and b.blocked_id = v_req.recipient_id)
       or (b.blocker_id = v_req.recipient_id and b.blocked_id = v_req.requester_id)
  ) then
    update public.chat_private_requests
      set status = 'rejected', responded_at = now()
      where id = p_request_id;
    return query select false, null::uuid, 'blocked';
    return;
  end if;

  if not p_accept then
    update public.chat_private_requests
      set status = 'rejected', responded_at = now()
      where id = p_request_id;

    begin
      insert into public.analytics_events (event_name, user_id, metadata)
      values ('chat_private_request_rejected', v_uid, jsonb_build_object('request_id', p_request_id));
    exception when others then
      raise warning 'respond_private_chat_request: analytics failed for %: %', p_request_id, sqlerrm;
    end;

    return query select true, null::uuid, null::text;
    return;
  end if;

  update public.chat_private_requests
    set status = 'accepted', responded_at = now()
    where id = p_request_id;

  v_lo := least(v_req.requester_id, v_req.recipient_id);
  v_hi := greatest(v_req.requester_id, v_req.recipient_id);

  -- ON CONFLICT DO NOTHING + select: defensa en profundidad -- con el
  -- índice único de pendientes por par, no debería poder existir ya una
  -- conversación para este par, pero si por lo que sea existiera, nunca
  -- se crea una segunda (punto 7: "evitar duplicar conversación A-B/B-A").
  insert into public.chat_private_conversations (user_a, user_b, request_id)
  values (v_lo, v_hi, p_request_id)
  on conflict (user_a, user_b) do nothing;

  select c.id into v_conv_id from public.chat_private_conversations c where c.user_a = v_lo and c.user_b = v_hi;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_private_request_accepted', v_uid, jsonb_build_object('request_id', p_request_id, 'conversation_id', v_conv_id));
  exception when others then
    raise warning 'respond_private_chat_request: analytics failed for %: %', p_request_id, sqlerrm;
  end;

  begin
    insert into public.notifications (user_id, kind, rival_user_id, private_conversation_id)
    values (v_req.requester_id, 'chat_private_request_accepted', v_uid, v_conv_id);
  exception when others then
    raise warning 'respond_private_chat_request: notification failed for %: %', p_request_id, sqlerrm;
  end;

  return query select true, v_conv_id, null::text;
end;
$$;

revoke all on function public.respond_private_chat_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_private_chat_request(uuid, boolean) to authenticated;

-- ============================================================
-- G) RPCs -- mensajes privados
-- ============================================================

create or replace function public.send_private_message(p_conversation_id uuid, p_body text)
returns table (id uuid, created_at timestamptz, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text;
  v_conv public.chat_private_conversations%rowtype;
  v_other_id uuid;
  v_recent_count int;
  v_last_from_me timestamptz;
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

  select * into v_conv from public.chat_private_conversations c where c.id = p_conversation_id;
  if not found then
    return query select null::uuid, null::timestamptz, 'not_found';
    return;
  end if;

  if v_uid <> v_conv.user_a and v_uid <> v_conv.user_b then
    return query select null::uuid, null::timestamptz, 'not_authorized';
    return;
  end if;

  v_other_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  if exists (
    select 1 from public.chat_blocks b
    where (b.blocker_id = v_uid and b.blocked_id = v_other_id)
       or (b.blocker_id = v_other_id and b.blocked_id = v_uid)
  ) then
    return query select null::uuid, null::timestamptz, 'blocked';
    return;
  end if;

  -- Mismo presupuesto que el chat global (V1): máx 5 mensajes privados
  -- cada 10 segundos, contados a través de TODAS las conversaciones de
  -- este remitente (`m.created_at` calificado con alias de tabla -- misma
  -- razón que en send_chat_message de V1: RETURNS TABLE ya declara una
  -- columna de salida `created_at`, un nombre sin calificar es ambiguo
  -- acá adentro).
  select count(*) into v_recent_count
  from public.chat_private_messages m
  where m.sender_id = v_uid and m.created_at > now() - interval '10 seconds';
  if v_recent_count >= 5 then
    return query select null::uuid, null::timestamptz, 'rate_limited';
    return;
  end if;

  insert into public.chat_private_messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_uid, v_body)
  returning public.chat_private_messages.id, public.chat_private_messages.created_at into v_id, v_created_at;

  -- `id` calificado con el nombre de tabla: esta función RETURNS
  -- TABLE(id, ...), así que "id" a secas acá adentro es ambiguo entre esa
  -- columna de salida y chat_private_conversations.id (mismo bug real que
  -- `created_at` en send_chat_message de V1 -- encontrado ejecutando esto
  -- de verdad contra Postgres, ni tsc ni el build lo detectan).
  update public.chat_private_conversations set last_message_at = v_created_at
    where chat_private_conversations.id = p_conversation_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_private_message_sent', v_uid, jsonb_build_object('conversation_id', p_conversation_id));
  exception when others then
    raise warning 'send_private_message: analytics failed for %: %', v_id, sqlerrm;
  end;

  -- Notificación de push con un debounce simple: solo si mi mensaje
  -- ANTERIOR a este en esta conversación fue hace más de 2 minutos (o no
  -- hay ninguno) -- evita que una ráfaga de mensajes dispare un push por
  -- cada uno (riesgo real de spam de notificaciones, nunca pedido).
  select max(m.created_at) into v_last_from_me
  from public.chat_private_messages m
  where m.conversation_id = p_conversation_id and m.sender_id = v_uid and m.id <> v_id;
  if v_last_from_me is null or v_last_from_me < now() - interval '2 minutes' then
    begin
      insert into public.notifications (user_id, kind, rival_user_id, private_conversation_id)
      values (v_other_id, 'chat_private_message', v_uid, p_conversation_id);
    exception when others then
      raise warning 'send_private_message: notification failed for %: %', v_id, sqlerrm;
    end;
  end if;

  return query select v_id, v_created_at, null::text;
end;
$$;

revoke all on function public.send_private_message(uuid, text) from public, anon, authenticated;
grant execute on function public.send_private_message(uuid, text) to authenticated;

-- ============================================================
-- H) RPCs -- bandeja e inbox
-- ============================================================

-- list_private_conversations: bandeja ordenada por última actividad,
-- con el nombre/avatar del OTRO lado ya resuelto y el conteo de no
-- leídos -- un solo round-trip para toda la pantalla de Privados.
create or replace function public.list_private_conversations()
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_username text,
  peer_avatar_emoji text,
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return;
  end if;

  return query
    select
      c.id,
      peer.id,
      peer.username,
      peer.avatar_emoji,
      c.last_message_at,
      (
        select m.body from public.chat_private_messages m
        where m.conversation_id = c.id and m.hidden_at is null
        order by m.created_at desc
        limit 1
      ),
      (
        select count(*) from public.chat_private_messages m
        where m.conversation_id = c.id
          and m.sender_id <> v_uid
          and m.hidden_at is null
          and m.created_at > coalesce(case when c.user_a = v_uid then c.last_read_at_a else c.last_read_at_b end, 'epoch'::timestamptz)
      )
    from public.chat_private_conversations c
    join public.profiles peer on peer.id = (case when c.user_a = v_uid then c.user_b else c.user_a end)
    where (c.user_a = v_uid or c.user_b = v_uid)
      and not (case when c.user_a = v_uid then c.hidden_by_a else c.hidden_by_b end)
    order by c.last_message_at desc;
end;
$$;

revoke all on function public.list_private_conversations() from public, anon, authenticated;
grant execute on function public.list_private_conversations() to authenticated;

create or replace function public.mark_private_conversation_read(p_conversation_id uuid)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conv public.chat_private_conversations%rowtype;
begin
  if v_uid is null then
    return query select false;
    return;
  end if;

  select * into v_conv from public.chat_private_conversations c where c.id = p_conversation_id;
  if not found or (v_uid <> v_conv.user_a and v_uid <> v_conv.user_b) then
    return query select false;
    return;
  end if;

  if v_conv.user_a = v_uid then
    update public.chat_private_conversations set last_read_at_a = now() where id = p_conversation_id;
  else
    update public.chat_private_conversations set last_read_at_b = now() where id = p_conversation_id;
  end if;

  return query select true;
end;
$$;

revoke all on function public.mark_private_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_private_conversation_read(uuid) to authenticated;

-- ============================================================
-- I) RPC -- bloqueo
-- ============================================================
create or replace function public.block_user(p_target_username text)
returns table (ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target_id uuid;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select p.id into v_target_id from public.profiles p where p.username = p_target_username;
  if v_target_id is null then
    return query select false, 'target_not_found';
    return;
  end if;

  if v_target_id = v_uid then
    return query select false, 'cannot_block_self';
    return;
  end if;

  insert into public.chat_blocks (blocker_id, blocked_id)
  values (v_uid, v_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Cualquier solicitud pendiente entre ambos queda cerrada. Así una
  -- solicitud creada antes del bloqueo no sigue apareciendo ni puede
  -- aceptarse después para saltarse la decisión de bloquear.
  update public.chat_private_requests
    set status = 'rejected', responded_at = now()
    where status = 'pending'
      and least(requester_id, recipient_id) = least(v_uid, v_target_id)
      and greatest(requester_id, recipient_id) = greatest(v_uid, v_target_id);

  -- Oculta la conversación de MI bandeja (si existe) -- nunca borra ni
  -- oculta mensajes históricos, y nunca toca la bandeja del bloqueado
  -- (punto 8: "ocultar conversación de la bandeja del usuario que
  -- bloqueó", "no romper mensajes históricos de base de datos").
  update public.chat_private_conversations
    set hidden_by_a = true
    where user_a = v_uid and user_b = v_target_id;
  update public.chat_private_conversations
    set hidden_by_b = true
    where user_b = v_uid and user_a = v_target_id;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_user_blocked', v_uid, jsonb_build_object('target_user_id', v_target_id));
  exception when others then
    raise warning 'block_user: analytics failed for %: %', v_target_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.block_user(text) from public, anon, authenticated;
grant execute on function public.block_user(text) to authenticated;

-- ============================================================
-- J) Push -- reusar el ÚNICO choke point existente (punto 12: "no crear
--    un segundo sistema de Push")
-- ============================================================
-- Mismo patrón idempotente ya usado 3 veces en este proyecto (ver
-- 20260902000000/20260903000000/20260905000000) -- widen del CHECK,
-- nunca se toca el trigger notify_push() ni push_subscriptions.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'challenge_accepted', 'challenge_completed', 'challenge_received', 'challenge_rejected',
    'referral_activated', 'new_follower', 'gift_received',
    'chat_private_request', 'chat_private_request_accepted', 'chat_private_message'
  ));

-- Desnormalizado para poder navegar directo a la conversación al tocar
-- la notificación/push -- mismo criterio ya usado para
-- challenge_share_token en esta misma tabla.
alter table public.notifications add column if not exists private_conversation_id uuid
  references public.chat_private_conversations(id) on delete set null;
