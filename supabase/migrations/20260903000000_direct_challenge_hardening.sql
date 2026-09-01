-- Bloque: Challenge directo "sigue fallando en producción" -- diagnóstico
-- real (ver el bloque de fix inmediato, secciones F-K). El fix anterior
-- (fetchMyLatestValidScanId) sigue siendo correcto -- esto es un hardening
-- adicional de la función misma, apuntado a la causa más probable
-- encontrada en la re-auditoría completa del SQL:
--
-- create_direct_challenge() hace DOS inserts en la misma transacción
-- implícita (challenges, luego notifications). Si el segundo insert
-- viola CUALQUIER constraint -- por ejemplo notifications_kind_check, que
-- en la migración anterior (20260902000000) se REEMPLAZA para aceptar
-- 'challenge_received'/'challenge_rejected' -- Postgres revierte TODA la
-- función, el RPC devuelve un error crudo no controlado (nunca uno de los
-- error_code explícitos de la función), y el cliente cae en el catch-all
-- genérico: exactamente el síntoma reportado ("No pudimos crear el
-- desafío" en vez de un mensaje específico). Si esa migración anterior no
-- llegó a aplicarse completa en producción (fuera del alcance de este
-- sandbox verificar contra la base real), esto lo explica por completo --
-- y aunque no lo sea, la notificación NUNCA debería poder tumbar la
-- creación real del Challenge, así que el fix es correcto de todas formas.
--
-- Dos cambios, ambos idempotentes (seguros de correr aunque ya estén
-- aplicados):
-- 1) Re-afirma el CHECK ampliado de notifications.kind (no-op si ya
--    estaba bien en producción).
-- 2) Reescribe create_direct_challenge/respond_direct_challenge/
--    accept_challenge para que el insert de notifications esté AISLADO en
--    su propio sub-bloque BEGIN/EXCEPTION -- un fallo ahí ya nunca puede
--    revertir el cambio de estado real (Challenge creado/aceptado/
--    rechazado), que es el resultado que de verdad le importa al usuario.
--    Además: username case-insensitive (mismo criterio que ya usa esta
--    base para email, ver 20260901000000) y un duplicate-guard (J: doble
--    tap / reintento del cliente después de una respuesta perdida en red
--    no debe crear un segundo Challenge -- devuelve el ya existente).

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('challenge_accepted', 'challenge_completed', 'challenge_received', 'challenge_rejected'));

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

  -- Case-insensitive: mismo criterio que ya usa esta base para email (ver
  -- 20260901000000, "lower(email) = lower(...)"), por si una discrepancia
  -- de mayúsculas fuera parte de lo que está fallando en algún caso real.
  select id into v_target_id from profiles where lower(username) = lower(p_target_username);
  if v_target_id is null then
    return query select null::uuid, null::text, false, 'target_not_found';
    return;
  end if;

  if v_target_id = v_uid then
    return query select null::uuid, null::text, false, 'cannot_challenge_self';
    return;
  end if;

  -- Idempotencia (J): un doble-tap real, o un reintento del cliente
  -- después de que la respuesta de un primer INSERT exitoso se perdiera
  -- en la red, no debe crear un segundo Challenge dirigido -- si ya hay
  -- uno mío 'pending' hacia este mismo target, se devuelve ESE (mismo
  -- comportamiento visible que si lo acabara de crear), sin volver a
  -- validar el scan siquiera.
  select id, share_token into v_new_id, v_token
  from challenges
  where from_user_id = v_uid and target_user_id = v_target_id and status = 'pending'
  limit 1;

  if v_new_id is not null then
    return query select v_new_id, v_token, true, null::text;
    return;
  end if;

  if not exists (select 1 from scans where id = p_source_scan_id and user_id = v_uid and status = 'done') then
    return query select null::uuid, null::text, false, 'invalid_scan';
    return;
  end if;

  v_token := encode(gen_random_bytes(5), 'hex');

  insert into challenges (share_token, source_scan_id, from_user_id, target_user_id, status)
  values (v_token, p_source_scan_id, v_uid, v_target_id, 'pending')
  returning id into v_new_id;

  -- Aislado a propósito (ver comentario del bloque): un fallo acá NUNCA
  -- debe revertir el insert de arriba, que ya es el resultado real que le
  -- importa al usuario -- sin notificación in-app en el peor caso, pero
  -- jamás con el Challenge fantasma que el mensaje genérico sugería.
  begin
    insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
    values (v_target_id, 'challenge_received', v_new_id, v_token, v_uid);
  exception when others then
    raise warning 'create_direct_challenge: notification insert failed for challenge %: %', v_new_id, sqlerrm;
  end;

  return query select v_new_id, v_token, true, null::text;
end;
$$;

grant execute on function public.create_direct_challenge(uuid, text) to authenticated;

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
    begin
      insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
      values (v_challenge.from_user_id, 'challenge_accepted', v_challenge.id, v_challenge.share_token, v_uid);
    exception when others then
      raise warning 'respond_direct_challenge: notification insert failed for challenge %: %', v_challenge.id, sqlerrm;
    end;
  else
    update challenges set status = 'rejected' where id = v_challenge.id;
    begin
      insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
      values (v_challenge.from_user_id, 'challenge_rejected', v_challenge.id, v_challenge.share_token, v_uid);
    exception when others then
      raise warning 'respond_direct_challenge: notification insert failed for challenge %: %', v_challenge.id, sqlerrm;
    end;
  end if;

  return query select true, null::text;
end;
$$;

grant execute on function public.respond_direct_challenge(uuid, boolean) to authenticated;

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

  begin
    insert into notifications (user_id, kind, challenge_id, challenge_share_token, rival_user_id)
    values (v_challenge.from_user_id, 'challenge_accepted', v_challenge.id, v_challenge.share_token, v_uid);
  exception when others then
    raise warning 'accept_challenge: notification insert failed for challenge %: %', v_challenge.id, sqlerrm;
  end;

  return query select v_challenge.id, true, null::text;
end;
$$;

grant execute on function public.accept_challenge(text) to authenticated;
