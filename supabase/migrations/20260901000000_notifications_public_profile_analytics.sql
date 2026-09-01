-- Bloque: unlimited tester persistente, notificaciones in-app reales,
-- perfil público mínimo, ranking por mejor Aura, y analytics_events.

-- ============================================================
-- 1) ventacuba@gmail.com como unlimited tester persistente (NO PRO)
-- ============================================================
-- Mismo patrón ya usado para ioan78dj@yahoo.es (ver
-- 20260829220000_unlimited_tester_flag.sql): resuelve el id por email en
-- la misma sentencia, no toca `plan` para nada -- is_unlimited_tester y
-- plan son columnas independientes (ver dailyLimit.ts: una cuenta de
-- prueba ilimitada se comporta igual sea cual sea su `plan`). Si el email
-- no existe todavía, el UPDATE no matchea ninguna fila y no falla.
update profiles
set is_unlimited_tester = true
where id = (select id from auth.users where lower(email) = lower('ventacuba@gmail.com'));

-- ============================================================
-- 2) Notificaciones in-app reales
-- ============================================================
-- Deliberadamente liviana: solo los datos para RENDERIZAR el mensaje
-- (kind + rival_user_id + result), nunca el texto ya armado -- mismo
-- criterio que useLatestChallengeResult (challengeService.ts), así el
-- texto vive en un solo lugar (el cliente) y nunca hay que migrar filas
-- viejas si cambia la redacción. `challenge_share_token` sí se
-- desnormaliza -- a diferencia del texto, es un dato que no cambia nunca
-- una vez creado y evita un JOIN extra solo para poder navegar al tocar
-- la notificación.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('challenge_accepted', 'challenge_completed')),
  challenge_id uuid references challenges(id) on delete set null,
  challenge_share_token text,
  rival_user_id uuid references profiles(id) on delete set null,
  -- Solo aplica a 'challenge_completed' -- null en 'challenge_accepted'.
  result text check (result is null or result in ('won', 'lost', 'tie')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_idx on notifications (user_id, created_at desc);
-- Índice parcial -- el badge de no-leídas es la query más frecuente de
-- esta tabla, y en la enorme mayoría de los casos la mayor parte de las
-- filas de un usuario activo van a estar leídas.
create index notifications_user_id_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;

create policy "notifications_select_own" on notifications
  for select using (auth.uid() = user_id);

grant select on notifications to authenticated;

-- Column-level grant: el cliente SOLO puede tocar `read_at` (marcar
-- leída) -- ni kind, ni challenge_id, ni rival_user_id, ni result son
-- otorgables, mismo patrón que profiles.username/avatar_emoji.
grant update (read_at) on notifications to authenticated;

create policy "notifications_update_own" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sin GRANT INSERT/DELETE para `authenticated` a propósito: solo
-- accept_challenge() (abajo) y resolveChallengeIfApplicable (Edge
-- Function, service_role) escriben acá. Un cliente nunca puede
-- fabricarse notificaciones propias.

-- ── accept_challenge: ahora también notifica al creador ─────────────────
-- CREATE OR REPLACE sobre la función de 20260829120000_challenge_real.sql
-- -- misma firma, mismo comportamiento de aceptación, un solo INSERT
-- nuevo antes del return final. El resto de la función (lock de fila,
-- checks de expirado/ya-tomado/auto-aceptación) queda intacto.
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
-- 3) Perfil público mínimo + Challenge stats de CUALQUIER usuario
-- ============================================================
-- Mismo patrón SECURITY DEFINER que get_my_challenge_stats (ver
-- 20260831120000_challenge_stats_and_leaderboard.sql), pero parametrizado
-- por username en vez de auth.uid() -- a propósito, es la única forma de
-- que esto sirva para un perfil AJENO. Solo devuelve columnas ya
-- aprobadas como públicas (ver auditoría de seguridad, sección L del
-- reporte): username, avatar, nivel, xp, mejor Aura, stats de Challenge.
-- NUNCA email, plan, pro_status ni ningún id técnico.
create or replace function public.get_public_profile(p_username text)
returns table (
  username text,
  avatar_emoji text,
  level int,
  xp bigint,
  best_aura_score int,
  challenges_completed int,
  wins int,
  losses int,
  ties int
)
language sql
security definer set search_path = public
stable
as $$
  select
    p.username,
    p.avatar_emoji,
    p.level,
    p.xp,
    (select max(s.aura_score) from scans s where s.user_id = p.id and s.status = 'done') as best_aura_score,
    count(c.id) filter (where c.status = 'completed')::int as challenges_completed,
    count(c.id) filter (where c.status = 'completed' and c.winner_user_id = p.id)::int as wins,
    count(c.id) filter (
      where c.status = 'completed' and c.winner_user_id is not null and c.winner_user_id <> p.id
    )::int as losses,
    count(c.id) filter (where c.status = 'completed' and c.is_tie)::int as ties
  from profiles p
  left join challenges c on c.from_user_id = p.id or c.opponent_user_id = p.id
  where p.username = p_username
  group by p.id;
$$;

grant execute on function public.get_public_profile(text) to authenticated;

-- ============================================================
-- 6) Ranking por mejor Aura (adicional al de XP ya existente)
-- ============================================================
-- Fiable sin trabajo nuevo: `best_aura_score` es el MÁXIMO histórico de un
-- solo campo por usuario, no una suma acumulable -- a diferencia de XP,
-- subir de posición acá requiere que Gemini haya calificado alto una
-- ejecución real puntual, no just volumen/grinding. No hay forma de
-- "farmear" un máximo reintentando: cada intento nuevo compite contra tu
-- propio mejor resultado, nunca lo suma.
create or replace function public.get_aura_leaderboard(p_limit int default 20)
returns table (
  username text,
  avatar_emoji text,
  best_aura_score int,
  rank bigint
)
language sql
security definer set search_path = public
stable
as $$
  select username, avatar_emoji, best_aura_score, rank
  from (
    select
      p.username,
      p.avatar_emoji,
      max(s.aura_score) as best_aura_score,
      rank() over (order by max(s.aura_score) desc) as rank
    from profiles p
    join scans s on s.user_id = p.id and s.status = 'done'
    group by p.id, p.username, p.avatar_emoji
  ) ranked
  order by rank
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_aura_leaderboard(int) to authenticated;

create or replace function public.get_my_aura_rank()
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select rank from (
    select
      p.id,
      rank() over (order by max(s.aura_score) desc) as rank
    from profiles p
    join scans s on s.user_id = p.id and s.status = 'done'
    group by p.id
  ) ranked
  where id = auth.uid();
$$;

grant execute on function public.get_my_aura_rank() to authenticated;

-- ============================================================
-- 12) Analítica mínima de funnel
-- ============================================================
-- Solo-inserción desde el cliente: cualquier usuario autenticado (o
-- anónimo, para eventos de pre-signup como "visita") puede insertar SU
-- PROPIO evento, nunca leerlos de vuelta -- esto es un log de escritura,
-- no una tabla que la app consulte; el análisis se hace por SQL
-- directamente con service_role. `user_id` nullable a propósito: una
-- "visita" o un signup en progreso todavía no tienen sesión.
create table analytics_events (
  id bigint generated always as identity primary key,
  -- 'visit' | 'signup' | 'email_confirmed' | 'first_scan' | 'challenge_created' |
  -- 'challenge_accepted' | 'share' | 'second_scan' | 'pro_checkout_opened' --
  -- sin CHECK constraint a propósito: nuevos eventos de funnel no deben
  -- necesitar una migración solo para agregar un nombre.
  event_name text not null,
  user_id uuid references profiles(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_name_created_idx on analytics_events (event_name, created_at desc);
create index analytics_events_user_id_idx on analytics_events (user_id);

alter table analytics_events enable row level security;

-- INSERT únicamente, para anon Y authenticated -- sin policy de SELECT
-- para ninguno de los dos: nadie puede leer eventos de otro usuario (ni
-- siquiera los propios) desde el cliente, solo escribir hacia adelante.
create policy "analytics_events_insert_any" on analytics_events
  for insert with check (user_id is null or user_id = auth.uid());

grant insert (event_name, user_id, metadata) on analytics_events to anon, authenticated;
