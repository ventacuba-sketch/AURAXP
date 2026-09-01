-- Bug real encontrado en el re-audit de Challenge: si la misma persona que
-- acepta un desafío toca ACEPTAR dos veces seguidas (doble tap, red lenta
-- reintentando), la segunda llamada caía en el mismo 'already_taken' que
-- un tercero robándose el link -- técnicamente no rompe nada (no duplica
-- opponent_user_id, no paga XP dos veces, el primer accept ya lo dejó en
-- 'accepted'), pero el mensaje que ve la persona es engañoso: dice "alguien
-- más ya lo tomó" cuando en realidad fue ella misma.
--
-- CREATE OR REPLACE FUNCTION -- no toca ningún type/tabla existente, solo
-- reemplaza el cuerpo de esta función puntual. No puede chocar con el
-- incidente anterior de migraciones (ese era por re-ejecutar un CREATE
-- TYPE ya aplicado).
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

  -- Ya lo aceptaste vos mismo antes (doble tap / reintento) -- no es un
  -- "already_taken" real, así que se devuelve ok=true directamente en vez
  -- de un error engañoso. Nunca reasigna ni vuelve a escribir la fila.
  if v_challenge.status = 'accepted' and v_challenge.opponent_user_id = v_uid then
    return query select v_challenge.id, true, null::text;
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
