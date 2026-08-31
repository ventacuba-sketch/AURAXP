-- Bloque: Challenge directo real (target_user_id), rechazo, racha, rivales
-- frecuentes, perfil público más útil, y las piezas de notifications/
-- analytics_events que ese trabajo necesita.

-- ============================================================
-- A) Challenge directo real
-- ============================================================
-- Nullable a propósito: el Challenge clásico por link sigue insertando
-- `target_user_id = null` (createChallenge en el cliente no cambia) --
-- accept_challenge() de abajo solo agrega un chequeo NUEVO que únicamente
-- se activa cuando target_user_id NO es null, así que el flujo clásico
-- queda bit a bit idéntico al de antes.
alter table challenges add column target_user_id uuid references profiles(id);

create index challenges_target_user_id_idx on challenges (target_user_id, status);

-- 'rejected', estado nuevo -- semánticamente distinto de 'cancelled'
-- (cancela el CREADOR mientras espera; rechaza el DESTINATARIO de un
-- Challenge dirigido). Se agrega al mismo CHECK existente, no se
-- reemplaza la columna ni se toca ninguna fila vieja.
alter table challenges drop constraint if exists challenges_status_check;
alter table challenges add constraint challenges_status_check
  check (status in ('pending', 'accepted', 'completed', 'cancelled', 'expired', 'rejected'));

-- RLS: el destinatario de un Challenge dirigido también necesita poder
-- verlo ANTES de aceptar (para que aparezca en "Recibidos") -- las
-- policies ya existentes (`from_user_id`/`opponent_user_id`) no lo cubren
-- todavía porque `opponent_user_id` se llena recién al aceptar. Postgres
-- combina policies de SELECT con OR, así que esto solo AGREGA acceso.
create policy "challenges_select_target" on challenges
  for select using (auth.uid() = target_user_id);

-- ── create_direct_challenge: crea un Challenge YA dirigido a alguien ────
-- Reusa el mismo esqueleto que insertaba el cliente para el link clásico
-- (share_token/source_scan_id/from_user_id) -- SOLO agrega target_user_id
-- y las validaciones que un INSERT directo del cliente no podía hacer
-- (verificar dueño+estado del scan, que el target exista, que no sea
-- auto-desafío). El resultado sigue siendo una fila de `challenges`
-- normal: ChallengeScreen/MyChallenges/resolución no necesitan saber que
-- existe este camino, ya la manejan igual que cualquier otra.
create or replace function public.create_direct_challenge(p_source_scan_id uuid, p_target_username text)
returns table (challenge_id uuid, share_token text, ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
  v_token text;
  v_new_id uuid;
begin
  if v_uid is null then
    return query select null::uuid, null::text, false, 'not_authenticated';
    return;
  end if;

  select id into v_target_id from profiles where username = p_target_username;
  if v_target_id is null then
    return query select null::uuid, null::text, false, 'target_not_found';
    return;
  end if;

  if v_target_id = v_uid then
    return query select null::uuid, null::text, false, 'cannot_challenge_self';
    return;
  end if;

  if not exists (select 1 from scans where id = p_source_scan_id and user_id = v_uid and status = 'done') then
    return query select null::uuid, null::text, false, 'invalid_scan';
    return;
  end if;

  -- Mismo formato que generateShareToken() del cliente (10 chars) -- no
  -- hace falta que coincida el algoritmo exacto, solo la forma; pgcrypto
  -- ya está habilitado (ver init_schema.sql).
  v_token := encode(gen_random_bytes(5), 'hex');

  insert into challenges (share_token, source_scan_id, from_user_id, target_user_id, status)
  values (v_token, p_source_scan_id, v_uid, v_target_id, 'pending')
  returning id into v_new_id;

  insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
  values (v_target_id, 'challenge_received', v_new_id, v_token, v_uid);

  return query select v_new_id, v_token, true, null::text;
end;
$$;

grant execute on function public.create_direct_challenge(uuid, text) to authenticated;

-- ── respond_direct_challenge: SOLO el target puede aceptar o rechazar ───
-- Mismo lock de fila (`for update`) que accept_challenge/cancel_challenge
-- -- dos respuestas casi simultáneas no pueden ambas tener éxito. Aceptar
-- deja el Challenge en 'accepted' -- EXACTAMENTE el mismo estado que deja
-- accept_challenge() para el flujo por link -- así que todo lo que viene
-- después (HACER MI SCAN, resolución, XP) es el mismo código sin cambios.
create or replace function public.respond_direct_challenge(p_challenge_id uuid, p_accept boolean)
returns table (ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_challenge challenges%rowtype;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select * into v_challenge from challenges where id = p_challenge_id for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_challenge.target_user_id is distinct from v_uid then
    return query select false, 'not_your_challenge';
    return;
  end if;

  if v_challenge.status = 'expired' or (v_challenge.status = 'pending' and v_challenge.expires_at < now()) then
    update challenges set status = 'expired' where id = v_challenge.id and status = 'pending';
    return query select false, 'expired';
    return;
  end if;

  if v_challenge.status <> 'pending' then
    return query select false, 'already_resolved';
    return;
  end if;

  if p_accept then
    update challenges set opponent_user_id = v_uid, status = 'accepted' where id = v_challenge.id;
    insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
    values (v_challenge.from_user_id, 'challenge_accepted', v_challenge.id, v_challenge.share_token, v_uid);
  else
    update challenges set status = 'rejected' where id = v_challenge.id;
    insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
    values (v_challenge.from_user_id, 'challenge_rejected', v_challenge.id, v_challenge.share_token, v_uid);
  end if;

  return query select true, null::text;
end;
$$;

grant execute on function public.respond_direct_challenge(uuid, boolean) to authenticated;

-- ── accept_challenge: cierra el hueco de seguridad del link clásico ─────
-- Si el share_token de un Challenge DIRIGIDO se filtrara igual (queda
-- generado por las dudas, ver create_direct_challenge), esto evita que
-- cualquiera que no sea el target lo acepte por esa otra puerta. Un
-- Challenge clásico (target_user_id null) no se ve afectado -- la
-- condición ni siquiera se evalúa como cierta.
create or replace function public.accept_challenge(p_share_token text)
returns table (challenge_id uuid, ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_challenge challenges%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select null::uuid, false, 'not_authenticated';
    return;
  end if;

  select * into v_challenge from challenges where share_token = p_share_token for update;

  if not found then
    return query select null::uuid, false, 'not_found';
    return;
  end if;

  if v_challenge.from_user_id = v_uid then
    return query select v_challenge.id, false, 'cannot_accept_own';
    return;
  end if;

  if v_challenge.target_user_id is not null and v_challenge.target_user_id <> v_uid then
    return query select v_challenge.id, false, 'not_your_challenge';
    return;
  end if;

  if v_challenge.status = 'expired' or (v_challenge.status = 'pending' and v_challenge.expires_at < now()) then
    update challenges set status = 'expired' where id = v_challenge.id and status = 'pending';
    return query select v_challenge.id, false, 'expired';
    return;
  end if;

  if v_challenge.status <> 'pending' then
    return query select v_challenge.id, false, 'already_taken';
    return;
  end if;

  update challenges
  set opponent_user_id = v_uid, status = 'accepted'
  where id = v_challenge.id;

  insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
  values (v_challenge.from_user_id, 'challenge_accepted', v_challenge.id, v_challenge.share_token, v_uid);

  return query select v_challenge.id, true, null::text;
end;
$$;

grant execute on function public.accept_challenge(text) to authenticated;

-- ============================================================
-- Notificaciones: dos kinds nuevos (recibido / rechazado)
-- ============================================================
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('challenge_accepted', 'challenge_completed', 'challenge_received', 'challenge_rejected'));

-- ============================================================
-- Analytics: lectura de los PROPIOS eventos -- necesario para que las
-- misiones diarias ("Comparte 1 resultado") puedan chequear un evento
-- real ya logueado en vez de inventar el estado en el cliente. Sigue sin
-- policy para leer eventos de OTRO usuario.
-- ============================================================
create policy "analytics_events_select_own" on analytics_events
  for select using (auth.uid() = user_id);

grant select on analytics_events to authenticated;

-- ============================================================
-- G) Rivales frecuentes -- derivado, sin tabla nueva
-- ============================================================
create or replace function public.get_frequent_rivals(p_limit int default 5)
returns table (
  rival_username text,
  rival_avatar_emoji text,
  games int,
  my_wins int,
  rival_wins int,
  ties int
)
language sql
security definer set search_path = public
stable
as $$
  select
    p.username,
    p.avatar_emoji,
    count(*)::int as games,
    count(*) filter (where c.winner_user_id = auth.uid())::int as my_wins,
    count(*) filter (where c.winner_user_id = p.id)::int as rival_wins,
    count(*) filter (where c.is_tie)::int as ties
  from challenges c
  join profiles p on p.id = (case when c.from_user_id = auth.uid() then c.opponent_user_id else c.from_user_id end)
  where c.status = 'completed' and (c.from_user_id = auth.uid() or c.opponent_user_id = auth.uid())
  group by p.id, p.username, p.avatar_emoji
  order by games desc, p.username
  limit greatest(1, least(p_limit, 20));
$$;

grant execute on function public.get_frequent_rivals(int) to authenticated;

-- ============================================================
-- H) Racha -- server-side, sin inflarse con Scans fallidos/duplicados
-- ============================================================
-- Un día "cuenta" si hubo al menos un Scan `done` ese día (UTC) -- `done`
-- ya excluye failed/rejected, y `distinct` sobre la fecha hace que 10
-- Scans el mismo día sigan contando como 1 solo día, así que no premia
-- spam. "Racha actual" solo sigue viva si el último día activo fue HOY o
-- AYER (si no, se cortó) -- mismo criterio que usan la mayoría de las
-- apps con racha diaria.
create or replace function public.get_my_streak()
returns table (current_streak int, best_streak int)
language sql
security definer set search_path = public
stable
as $$
  with days as (
    select distinct (created_at at time zone 'utc')::date as d
    from scans
    where user_id = auth.uid() and status = 'done'
  ),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp
    from days
  ),
  streaks as (
    select max(d) as end_d, count(*)::int as len
    from islands
    group by grp
  )
  select
    coalesce((select len from streaks where end_d >= (now() at time zone 'utc')::date - 1), 0) as current_streak,
    coalesce((select max(len) from streaks), 0) as best_streak;
$$;

grant execute on function public.get_my_streak() to authenticated;

-- ============================================================
-- E) Perfil público más útil -- ranking y últimos resultados
-- ============================================================
-- Mismo cálculo que get_my_xp_rank, parametrizado por username -- barato
-- (un solo rank() sobre `profiles`, ya se paga ese costo en el ranking).
create or replace function public.get_public_xp_rank(p_username text)
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select rank from (
    select id, username, rank() over (order by xp desc) as rank from profiles
  ) ranked
  where username = p_username;
$$;

grant execute on function public.get_public_xp_rank(text) to authenticated;

-- Últimos resultados PÚBLICOS de Challenge de un usuario -- solo lo que
-- ya es seguro compartir (rival/resultado/fecha/scores), nunca IDs ni
-- paths (ver auditoría de seguridad de la result card, mismo criterio acá).
create or replace function public.get_public_recent_results(p_username text, p_limit int default 5)
returns table (
  rival_username text,
  rival_avatar_emoji text,
  my_score int,
  rival_score int,
  is_tie boolean,
  i_won boolean,
  resolved_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select
    rp.username,
    rp.avatar_emoji,
    (case when c.from_user_id = p.id then ss.aura_score else ts.aura_score end) as my_score,
    (case when c.from_user_id = p.id then ts.aura_score else ss.aura_score end) as rival_score,
    c.is_tie,
    (c.winner_user_id = p.id) as i_won,
    c.resolved_at
  from challenges c
  join profiles p on p.username = p_username
  join profiles rp on rp.id = (case when c.from_user_id = p.id then c.opponent_user_id else c.from_user_id end)
  left join scans ss on ss.id = c.source_scan_id
  left join scans ts on ts.id = c.target_scan_id
  where c.status = 'completed' and (c.from_user_id = p.id or c.opponent_user_id = p.id)
  order by c.resolved_at desc
  limit greatest(1, least(p_limit, 10));
$$;

grant execute on function public.get_public_recent_results(text, int) to authenticated;
