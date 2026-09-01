-- Challenge real 1 vs 1 (reemplaza la simulación actual).
--
-- No borra datos: extiende `challenges` con las columnas de estado que
-- faltaban y hace un backfill best-effort de las filas que ya existieran
-- (si las hay -- el flujo de aceptación nunca funcionó de verdad hasta
-- ahora, así que no debería haber ninguna real). No se paga XP retroactivo
-- por el backfill.

-- ============================================================
-- Columnas nuevas
-- ============================================================
alter table challenges add column status text not null default 'pending';
alter table challenges add column opponent_user_id uuid references profiles(id);
alter table challenges add column winner_user_id uuid references profiles(id);
alter table challenges add column is_tie boolean not null default false;
alter table challenges add column resolved_at timestamptz;
-- 72h es la ventana de expiración para un invite que nadie aceptó --
-- razonable para MVP, evita invites "fantasma" indefinidos sin más
-- infraestructura que un check en el momento de leer/aceptar.
alter table challenges add column expires_at timestamptz not null default (now() + interval '72 hours');
-- Registran lo que efectivamente se pagó -- útil para mostrar "+XP" en el
-- resultado sin tener que re-derivarlo, y como evidencia de que ya se pagó.
alter table challenges add column creator_xp_awarded int;
alter table challenges add column opponent_xp_awarded int;

alter table challenges add constraint challenges_status_check
  check (status in ('pending', 'accepted', 'completed', 'cancelled', 'expired'));

-- Defensa en profundidad además del check en accept_challenge(): un
-- challenge nunca puede tener como oponente a su propio creador, ni a
-- nivel de función ni si alguna vez se escribiera la columna por otra vía.
alter table challenges add constraint challenges_no_self_accept
  check (opponent_user_id is null or opponent_user_id <> from_user_id);

-- El ganador, si hay uno, tiene que ser alguno de los dos participantes --
-- nunca un id arbitrario.
alter table challenges add constraint challenges_winner_is_participant
  check (winner_user_id is null or winner_user_id = from_user_id or winner_user_id = opponent_user_id);

-- ============================================================
-- Backfill de filas preexistentes (best-effort, sin pagar XP)
-- ============================================================
update challenges
set opponent_user_id = (select user_id from scans where scans.id = challenges.target_scan_id)
where target_scan_id is not null and opponent_user_id is null;

update challenges
set status = 'completed', resolved_at = coalesce(resolved_at, created_at)
where target_scan_id is not null and status = 'pending';

-- ============================================================
-- Índices
-- ============================================================
create index challenges_opponent_user_id_idx on challenges (opponent_user_id);
create index challenges_status_idx on challenges (status);
create index challenges_from_user_id_status_idx on challenges (from_user_id, status);

-- ============================================================
-- RLS: el oponente también puede ver el challenge una vez que lo acepta
-- (la policy original solo cubría a from_user_id). Postgres combina las
-- policies de SELECT con OR, así que esto solo AGREGA acceso, no le quita
-- nada a la policy existente.
-- ============================================================
create policy "challenges_select_opponent" on challenges
  for select using (auth.uid() = opponent_user_id);

-- ============================================================
-- scans/Storage: un participante de un Challenge ya COMPLETADO puede ver
-- el scan (y el video) del otro participante -- antes de completarse
-- sigue oculto, así nadie ve el resultado del rival mientras el duelo
-- sigue en juego. Alcance acotado a propósito: solo scans que son
-- literalmente source_scan_id/target_scan_id de un challenge 'completed'
-- donde el que pide sos vos mismo (from_user_id u opponent_user_id).
-- ============================================================
create policy "scans_select_completed_challenge_rival" on scans
  for select using (
    exists (
      select 1 from challenges c
      where (c.source_scan_id = scans.id or c.target_scan_id = scans.id)
        and c.status = 'completed'
        and (c.from_user_id = auth.uid() or c.opponent_user_id = auth.uid())
    )
  );

create policy "scans_bucket_select_completed_challenge_rival" on storage.objects
  for select using (
    bucket_id = 'scans'
    and exists (
      select 1 from challenges c
      join scans s on s.video_path = storage.objects.name
      where (c.source_scan_id = s.id or c.target_scan_id = s.id)
        and c.status = 'completed'
        and (c.from_user_id = auth.uid() or c.opponent_user_id = auth.uid())
    )
  );

-- ============================================================
-- Nunca se otorga UPDATE directo sobre challenges a `authenticated` --
-- a propósito. Todas las transiciones de estado (aceptar, cancelar,
-- resolver) pasan por funciones SECURITY DEFINER de abajo, que son las
-- únicas que pueden escribir status/winner_user_id/xp_awarded/etc. Un
-- cliente nunca puede declararse ganador ni asignarse XP directamente.
-- ============================================================

-- ── accept_challenge: aceptación atómica, sin condición de carrera ──────
-- `select ... for update` bloquea la fila hasta el commit de esta
-- transacción -- si dos personas intentan aceptar el mismo link casi al
-- mismo tiempo, la segunda espera a que termine la primera y después ve
-- status <> 'pending', así que no puede "robarse" un challenge ya tomado.
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

  return query select v_challenge.id, true, null::text;
end;
$$;

grant execute on function public.accept_challenge(text) to authenticated;

-- ── cancel_challenge: solo el creador, solo mientras está 'pending' ─────
create or replace function public.cancel_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated int;
begin
  update challenges
  set status = 'cancelled'
  where id = p_challenge_id
    and from_user_id = auth.uid()
    and status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.cancel_challenge(uuid) to authenticated;
