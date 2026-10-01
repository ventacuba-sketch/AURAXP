-- CHAT V1 -- una sola sala global, mensajes + reacciones + identidad de
-- invitado + recompensa de bienvenida idempotente.
--
-- Auditado primero (ver reporte de esta tarea): no existía ninguna tabla
-- de mensajería/chat/guest_sessions en el proyecto. Se reutiliza TODO lo
-- que ya existe -- profiles (identidad), wallets/coin_transactions vía
-- apply_coin_transaction (economía), el patrón visitor_id ya usado por
-- campaign_attributions (identidad de invitado, mismo formato/validación,
-- NUNCA un auth.users nuevo por visitante). Solo se crean las 3 tablas
-- que realmente hacían falta: chat_messages, chat_reactions,
-- chat_guest_rewards.
--
-- IMPORTANTE (independencia de ramas): esta rama (feature/chat-v1) sale
-- de main, NO de la rama del dashboard de analítica -- a propósito, para
-- no mezclar ambas implementaciones todavía (ver pedido de esta tarea).
-- La rama del dashboard agrega por su cuenta profiles.is_admin
-- (20261001020000_admin_dashboard_role_column.sql, todavía sin mergear a
-- main). Moderación acá (sección E, hide_chat_message) necesita ESE mismo
-- flag -- se agrega la columna de nuevo con `add column if not exists`,
-- exactamente el mismo nombre/tipo/default que esa migración, para que
-- cuando ambas ramas se mergeen a main el resultado converja sin
-- conflicto (cualquiera de las dos que corra primero, la otra es un
-- no-op). Esta migración NO reactiva ninguna cuenta como admin -- eso
-- sigue siendo responsabilidad exclusiva de la rama del dashboard; hasta
-- que esa rama se mergee, hide_chat_message() queda correctamente
-- cableada pero inerte (nadie tiene is_admin=true todavía).
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- ============================================================
-- A) Identidad social mínima para el chat -- status predefinido
-- ============================================================
-- Columna cosmética y de bajo riesgo (no afecta Aura/XP/economía), pero
-- se expone solo vía set_chat_status() (abajo) en vez de agregarla a
-- algún GRANT UPDATE de columnas de `profiles` -- evita depender de
-- cuántas columnas tenga ese GRANT hoy en esta rama y deja la validación
-- del enum 100% server-side.
alter table public.profiles add column if not exists chat_status text;
alter table public.profiles drop constraint if exists profiles_chat_status_check;
alter table public.profiles add constraint profiles_chat_status_check
  check (chat_status is null or chat_status in ('farming_aura', 'looking_rival', 'chill', 'top_aura'));

-- Vista pública mínima para el chat -- igual criterio que public_profiles
-- (vista = corre con los privilegios de quien la crea, no del caller, así
-- que expone columnas puntuales de una tabla con RLS restrictiva sin
-- ampliar esa RLS). Separada de `public_profiles` a propósito: no se
-- toca esa vista ni a nadie que ya dependa de su forma exacta.
create or replace view public.chat_public_profiles as
  select id, username, avatar_emoji, level, chat_status from public.profiles;

grant select on public.chat_public_profiles to anon, authenticated;

-- ============================================================
-- B) Mensajes
-- ============================================================
-- Exactamente uno de user_id/guest_id -- nunca ambos, nunca ninguno.
-- guest_id es el MISMO visitor_id que ya usa campaign_attributions (texto
-- persistido client-side, 8-200 chars, ver campaignService.ts) -- no se
-- crea un segundo identificador de invitado.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_id text,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id) on delete set null,
  constraint chat_messages_sender_xor check (
    (user_id is not null and guest_id is null) or (user_id is null and guest_id is not null)
  ),
  constraint chat_messages_guest_id_format check (guest_id is null or (length(guest_id) >= 8 and length(guest_id) <= 200)),
  constraint chat_messages_body_length check (char_length(body) >= 1 and char_length(body) <= 300)
);

-- Índice principal: "últimos N mensajes visibles", exactamente el query
-- que hace la pantalla -- parcial (solo filas visibles) para que no pese
-- el historial moderado/oculto a medida que crece.
create index if not exists chat_messages_recent_idx
  on public.chat_messages (created_at desc) where hidden_at is null;

-- Soporte del rate-limit de send_chat_message (abajo): "cuántos mandó
-- este remitente en los últimos N segundos", por user_id o por guest_id.
create index if not exists chat_messages_rate_user_idx on public.chat_messages (user_id, created_at desc) where user_id is not null;
create index if not exists chat_messages_rate_guest_idx on public.chat_messages (guest_id, created_at desc) where guest_id is not null;

alter table public.chat_messages enable row level security;

-- Mensajes públicos por diseño (es un chat global) -- pero SOLO los no
-- ocultos, para todos (anon y authenticated), sin excepción para admin:
-- moderar en V1 es simple (ocultar), no hace falta una vista "solo admin"
-- de lo oculto todavía.
drop policy if exists "chat_messages_select_visible" on public.chat_messages;
create policy "chat_messages_select_visible" on public.chat_messages
  for select using (hidden_at is null);

grant select on public.chat_messages to anon, authenticated;
-- Sin INSERT/UPDATE/DELETE para anon/authenticated a propósito -- todo
-- pasa por send_chat_message()/hide_chat_message() (SECURITY DEFINER),
-- nunca un insert directo del cliente (ahí es donde viven la validación
-- real, el rate limit y la resolución de identidad guest/usuario).

-- ============================================================
-- C) Reacciones -- set fijo y pequeño a propósito (ver sección 7 del
-- pedido: packs pagos quedan para más adelante, V1 no regala variedad).
-- ============================================================
create table if not exists public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_id text,
  emoji text not null check (emoji in ('🔥', '⚡', '😂', '👑', '💀')),
  created_at timestamptz not null default now(),
  constraint chat_reactions_sender_xor check (
    (user_id is not null and guest_id is null) or (user_id is null and guest_id is not null)
  ),
  constraint chat_reactions_guest_id_format check (guest_id is null or (length(guest_id) >= 8 and length(guest_id) <= 200))
);

-- Evita que el mismo usuario/guest repita la MISMA reacción en el MISMO
-- mensaje -- la UI lo trata como "toggle" (ver toggle_chat_reaction).
create unique index if not exists chat_reactions_unique_user on public.chat_reactions (message_id, user_id, emoji) where user_id is not null;
create unique index if not exists chat_reactions_unique_guest on public.chat_reactions (message_id, guest_id, emoji) where guest_id is not null;
create index if not exists chat_reactions_message_idx on public.chat_reactions (message_id);

alter table public.chat_reactions enable row level security;

drop policy if exists "chat_reactions_select_all" on public.chat_reactions;
create policy "chat_reactions_select_all" on public.chat_reactions
  for select using (true);

grant select on public.chat_reactions to anon, authenticated;
-- Igual que chat_messages: sin INSERT/DELETE directo, todo vía
-- toggle_chat_reaction() (rate limit + validación + identidad).

-- ============================================================
-- D) Recompensa de bienvenida para invitados (Coins pendientes)
-- ============================================================
-- Nada de esto es una wallet paralela: es solo el registro de "a este
-- guest_id se le debe una recompensa de bienvenida, todavía no
-- reclamada" -- el crédito REAL sigue pasando por apply_coin_transaction
-- (el único camino real a tocar un saldo, ver
-- 20260905000000_wallet_coins_economy.sql). Sin acceso de cliente a esta
-- tabla en absoluto (ni SELECT): el estado se devuelve como resultado de
-- las RPCs de abajo, nunca leído directo.
create table if not exists public.chat_guest_rewards (
  guest_id text primary key check (length(guest_id) >= 8 and length(guest_id) <= 200),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by_user_id uuid references public.profiles(id) on delete set null
);

alter table public.chat_guest_rewards enable row level security;
-- RLS habilitada, CERO policies -- deniega todo acceso directo de
-- cliente (anon/authenticated), con o sin GRANT. Solo las funciones
-- SECURITY DEFINER de abajo pueden leer/escribir acá.

-- 'chat_guest_reward' es un type nuevo -- mismo patrón ya usado para
-- 'referral_activated' en notifications.kind: widen idempotente del
-- CHECK existente, nunca se toca la función ni la tabla de ledger en sí.
alter table public.coin_transactions drop constraint if exists coin_transactions_type_check;
alter table public.coin_transactions add constraint coin_transactions_type_check
  check (type in (
    'signup_bonus', 'mission_reward', 'streak_bonus',
    'referral_referrer_bonus', 'referral_referred_bonus',
    'pro_monthly_bonus', 'store_purchase', 'gift_sent',
    'chat_guest_reward'
  ));

-- ============================================================
-- E) RPCs
-- ============================================================

-- send_chat_message: único camino para insertar un mensaje. Resuelve el
-- remitente real (auth.uid() si hay sesión, guest_id del cliente si no
-- -- nunca confía en que el cliente diga "soy fulano"), valida longitud
-- y aplica un rate-limit básico (máx 5 mensajes cada 10 segundos por
-- remitente). search_path vacío + todo fully-qualified, mismo patrón ya
-- usado en el dashboard de analítica.
create or replace function public.send_chat_message(
  p_body text,
  p_guest_id text default null
)
returns table (id uuid, created_at timestamptz, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_guest_id text;
  v_body text;
  v_recent_count int;
  v_id uuid;
  v_created_at timestamptz;
begin
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' or char_length(v_body) > 300 then
    return query select null::uuid, null::timestamptz, 'invalid_body';
    return;
  end if;

  if v_uid is null then
    v_guest_id := p_guest_id;
    if v_guest_id is null or length(v_guest_id) < 8 or length(v_guest_id) > 200 then
      return query select null::uuid, null::timestamptz, 'invalid_guest_id';
      return;
    end if;
  end if;

  -- `created_at` calificado con el nombre de tabla: esta función RETURNS
  -- TABLE(..., created_at timestamptz, ...), así que "created_at" a secas
  -- es ambiguo acá adentro -- Postgres no sabe si te referís a esa columna
  -- de salida o a la de chat_messages (encontrado ejecutando esto de
  -- verdad contra Postgres, ni tsc ni el build lo detectan).
  if v_uid is not null then
    select count(*) into v_recent_count
    from public.chat_messages m
    where m.user_id = v_uid and m.created_at > now() - interval '10 seconds';
  else
    select count(*) into v_recent_count
    from public.chat_messages m
    where m.guest_id = v_guest_id and m.created_at > now() - interval '10 seconds';
  end if;

  if v_recent_count >= 5 then
    return query select null::uuid, null::timestamptz, 'rate_limited';
    return;
  end if;

  insert into public.chat_messages (user_id, guest_id, body)
  values (v_uid, v_guest_id, v_body)
  returning public.chat_messages.id, public.chat_messages.created_at into v_id, v_created_at;

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_message_sent', v_uid, case when v_guest_id is not null then jsonb_build_object('visitor_id', v_guest_id) else null end);
  exception when others then
    raise warning 'send_chat_message: analytics failed for %: %', v_id, sqlerrm;
  end;

  return query select v_id, v_created_at, null::text;
end;
$$;

revoke all on function public.send_chat_message(text, text) from public, anon, authenticated;
grant execute on function public.send_chat_message(text, text) to anon, authenticated;

-- toggle_chat_reaction: inserta si no existe, borra si ya existía (mismo
-- remitente, mismo mensaje, mismo emoji) -- así la UI solo necesita
-- "tocar el emoji" sin preguntar primero. Mismo rate-limit básico que los
-- mensajes para que no sea una vía alternativa de inundar la tabla.
create or replace function public.toggle_chat_reaction(
  p_message_id uuid,
  p_emoji text,
  p_guest_id text default null
)
returns table (reacted boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_guest_id text;
  v_existing_id uuid;
  v_recent_count int;
begin
  if p_emoji not in ('🔥', '⚡', '😂', '👑', '💀') then
    return query select false, 'invalid_emoji';
    return;
  end if;

  if not exists (select 1 from public.chat_messages m where m.id = p_message_id and m.hidden_at is null) then
    return query select false, 'message_not_found';
    return;
  end if;

  if v_uid is null then
    v_guest_id := p_guest_id;
    if v_guest_id is null or length(v_guest_id) < 8 or length(v_guest_id) > 200 then
      return query select false, 'invalid_guest_id';
      return;
    end if;
  end if;

  if v_uid is not null then
    select id into v_existing_id from public.chat_reactions
    where message_id = p_message_id and user_id = v_uid and emoji = p_emoji;
  else
    select id into v_existing_id from public.chat_reactions
    where message_id = p_message_id and guest_id = v_guest_id and emoji = p_emoji;
  end if;

  if v_existing_id is not null then
    delete from public.chat_reactions where id = v_existing_id;
    return query select false, null::text;
    return;
  end if;

  if v_uid is not null then
    select count(*) into v_recent_count from public.chat_reactions
    where user_id = v_uid and created_at > now() - interval '10 seconds';
  else
    select count(*) into v_recent_count from public.chat_reactions
    where guest_id = v_guest_id and created_at > now() - interval '10 seconds';
  end if;

  if v_recent_count >= 10 then
    return query select false, 'rate_limited';
    return;
  end if;

  insert into public.chat_reactions (message_id, user_id, guest_id, emoji)
  values (p_message_id, v_uid, v_guest_id, p_emoji);

  begin
    insert into public.analytics_events (event_name, user_id, metadata)
    values ('chat_reaction_added', v_uid, jsonb_build_object('emoji', p_emoji) || case when v_guest_id is not null then jsonb_build_object('visitor_id', v_guest_id) else '{}'::jsonb end);
  exception when others then
    raise warning 'toggle_chat_reaction: analytics failed: %', sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

revoke all on function public.toggle_chat_reaction(uuid, text, text) from public, anon, authenticated;
grant execute on function public.toggle_chat_reaction(uuid, text, text) to anon, authenticated;

-- set_chat_status: valida el enum server-side, nunca texto libre.
create or replace function public.set_chat_status(p_status text)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return query select false;
    return;
  end if;
  if p_status is not null and p_status not in ('farming_aura', 'looking_rival', 'chill', 'top_aura') then
    return query select false;
    return;
  end if;
  update public.profiles set chat_status = p_status where id = v_uid;
  return query select true;
end;
$$;

revoke all on function public.set_chat_status(text) from public, anon, authenticated;
grant execute on function public.set_chat_status(text) to authenticated;

-- hide_chat_message: moderación mínima viable -- reusa profiles.is_admin
-- (el mismo flag del dashboard de analítica, 20261001020000 en la rama
-- del dashboard), no crea un segundo rol/sistema de permisos.
create or replace function public.hide_chat_message(p_message_id uuid)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
begin
  if v_uid is null then
    return query select false;
    return;
  end if;

  select p.is_admin into v_is_admin from public.profiles p where p.id = v_uid;
  if v_is_admin is not true then
    return query select false;
    return;
  end if;

  update public.chat_messages set hidden_at = now(), hidden_by = v_uid where id = p_message_id;
  return query select true;
end;
$$;

revoke all on function public.hide_chat_message(uuid) from public, anon, authenticated;
grant execute on function public.hide_chat_message(uuid) to authenticated;

-- ensure_chat_guest_reward: idempotente por diseño (ON CONFLICT DO
-- NOTHING sobre la PK guest_id) -- llamarla 1 o 1000 veces con el mismo
-- guest_id nunca crea más de una fila ni cambia el monto ya fijado.
-- Llamarla recién ante una señal real de intención (primer mensaje o
-- primera reacción del invitado), no solo por abrir la pantalla.
create or replace function public.ensure_chat_guest_reward(p_guest_id text)
returns table (amount bigint, claimed boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_guest_id is null or length(p_guest_id) < 8 or length(p_guest_id) > 200 then
    return query select null::bigint, null::boolean, 'invalid_guest_id';
    return;
  end if;

  insert into public.chat_guest_rewards (guest_id, amount)
  values (p_guest_id, 200)
  on conflict (guest_id) do nothing;

  return query
    select r.amount, (r.claimed_at is not null), null::text
    from public.chat_guest_rewards r
    where r.guest_id = p_guest_id;
end;
$$;

revoke all on function public.ensure_chat_guest_reward(text) from public, anon, authenticated;
grant execute on function public.ensure_chat_guest_reward(text) to anon, authenticated;

-- claim_chat_guest_reward: la ÚNICA función que de verdad acredita Coins,
-- y solo con sesión real. Doble guardia de idempotencia: el claimed_at de
-- esta tabla (chequeado y seteado dentro de la misma transacción) Y el
-- idempotency_key de apply_coin_transaction -- cualquiera de los dos solo
-- ya alcanza para que un reintento nunca duplique el crédito.
create or replace function public.claim_chat_guest_reward(p_guest_id text)
returns table (ok boolean, coins_awarded bigint, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.chat_guest_rewards%rowtype;
  v_tx_ok boolean;
  v_tx_new_balance bigint;
  v_tx_error text;
  v_tx_id uuid;
begin
  if v_uid is null then
    return query select false, 0::bigint, 'not_authorized';
    return;
  end if;
  if p_guest_id is null or length(p_guest_id) < 8 or length(p_guest_id) > 200 then
    return query select false, 0::bigint, 'invalid_guest_id';
    return;
  end if;

  select * into v_row from public.chat_guest_rewards where guest_id = p_guest_id for update;
  if not found then
    return query select false, 0::bigint, 'no_reward';
    return;
  end if;
  if v_row.claimed_at is not null then
    return query select true, 0::bigint, 'already_claimed';
    return;
  end if;

  select t.ok, t.new_balance, t.error_code, t.transaction_id
    into v_tx_ok, v_tx_new_balance, v_tx_error, v_tx_id
  from public.apply_coin_transaction(
    v_uid, v_row.amount, 'chat_guest_reward', 'chat_guest_rewards', null, 'chat_guest_reward_' || p_guest_id
  ) t;

  if not v_tx_ok then
    return query select false, 0::bigint, coalesce(v_tx_error, 'tx_failed');
    return;
  end if;

  update public.chat_guest_rewards set claimed_at = now(), claimed_by_user_id = v_uid where guest_id = p_guest_id;

  return query select true, v_row.amount, null::text;
end;
$$;

revoke all on function public.claim_chat_guest_reward(text) from public, anon, authenticated;
grant execute on function public.claim_chat_guest_reward(text) to authenticated;
