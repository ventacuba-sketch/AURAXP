-- Perfil social mínimo (F) + Ranking simple (G).
--
-- Ambas cosas se calculan server-side con funciones SECURITY DEFINER --
-- mismo patrón ya establecido por accept_challenge/cancel_challenge: nunca
-- reciben un user id como parámetro, siempre operan sobre auth.uid()
-- (get_my_*) o son de solo lectura agregada (get_xp_leaderboard), así que
-- no hay forma de usarlas para leer datos de otro usuario por fuera de lo
-- que ya es público. Se calculan con una sola query cada una, apoyadas en
-- índices que ya existen (challenges_from_user_id_status_idx,
-- challenges_opponent_user_id_idx, scans_user_id_idx) -- no hace falta una
-- tabla de agregados separada a esta escala.

-- ============================================================
-- F) Stats de Challenge del usuario actual
-- ============================================================
create or replace function public.get_my_challenge_stats()
returns table (
  challenges_completed int,
  wins int,
  losses int,
  ties int,
  best_aura_score int,
  avg_aura_score numeric
)
language sql
security definer set search_path = public
stable
as $$
  select
    count(*) filter (where c.status = 'completed')::int as challenges_completed,
    count(*) filter (where c.status = 'completed' and c.winner_user_id = auth.uid())::int as wins,
    count(*) filter (
      where c.status = 'completed' and c.winner_user_id is not null and c.winner_user_id <> auth.uid()
    )::int as losses,
    count(*) filter (where c.status = 'completed' and c.is_tie)::int as ties,
    (select max(s.aura_score) from scans s where s.user_id = auth.uid() and s.status = 'done') as best_aura_score,
    (select round(avg(s.aura_score), 1) from scans s where s.user_id = auth.uid() and s.status = 'done') as avg_aura_score
  from challenges c
  where c.from_user_id = auth.uid() or c.opponent_user_id = auth.uid();
$$;

grant execute on function public.get_my_challenge_stats() to authenticated;

-- ============================================================
-- G) Ranking simple -- TOP AURA por XP acumulado (lifetime).
-- ============================================================
-- Por qué XP acumulado y no un ranking semanal: `profiles.xp` ya es la
-- única cifra de progreso que existe (acumulativa, sin snapshot por
-- semana) -- un ranking semanal necesitaría una tabla nueva de eventos de
-- XP con fecha, que no existe todavía. Ver el reporte de esta tarea para
-- el detalle de qué haría falta agregar para eso.
--
-- Por qué es razonablemente anti-farming SIN trabajo nuevo: el XP que
-- entra a `profiles.xp` ya pasa por daily_scan_counts (tope diario de
-- Scans que cuentan XP, ver _shared/scoring.ts DAILY_XP_SCAN_CAP) y por el
-- dedupe de video_hash en process-scan (resubir el mismo clip da 0 XP) --
-- este ranking no le agrega ni le saca nada a esas protecciones, solo
-- muestra un número que ya estaba protegido.
--
-- username/avatar_emoji ya son públicos hoy (ver public_profiles, usados
-- para el preview de cualquier Challenge) -- lo único nuevo que este
-- ranking expone es xp/level de los primeros N perfiles, nunca de todos
-- (ver auditoría de seguridad, sección L del reporte).
create or replace function public.get_xp_leaderboard(p_limit int default 20)
returns table (
  username text,
  avatar_emoji text,
  xp bigint,
  level int,
  rank bigint
)
language sql
security definer set search_path = public
stable
as $$
  select username, avatar_emoji, xp, level, rank
  from (
    select username, avatar_emoji, xp, level, rank() over (order by xp desc) as rank
    from profiles
  ) ranked
  order by rank
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_xp_leaderboard(int) to authenticated;

-- Posición del usuario actual, exista o no en el Top N de arriba --
-- separada a propósito para no tener que traer la tabla entera al cliente
-- solo para calcular "estás en el puesto #134".
create or replace function public.get_my_xp_rank()
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select rank from (
    select id, rank() over (order by xp desc) as rank from profiles
  ) ranked
  where id = auth.uid();
$$;

grant execute on function public.get_my_xp_rank() to authenticated;
