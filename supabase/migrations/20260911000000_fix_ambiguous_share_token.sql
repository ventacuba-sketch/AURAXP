-- Bug real confirmado en producción (auditoría, log directo de
-- analytics_events durante una reproducción real): "Ranking -> Perfil
-- -> DESAFIAR" fallaba SIEMPRE con SQLSTATE 42702 --
-- "column reference \"share_token\" is ambiguous" -- descartadas antes
-- las hipótesis de scanId incorrecto, migración 20260903000000 faltante
-- y notifications_kind_check desactualizado (las tres confirmadas OK en
-- producción).
--
-- Causa real: create_direct_challenge() declara
-- `returns table (challenge_id uuid, share_token text, ok boolean,
-- error_code text)` -- Postgres crea una variable de salida `share_token`
-- con ese nombre. El chequeo de idempotencia (J: "no crear un segundo
-- Challenge dirigido si ya hay uno pending hacia el mismo target") lee
-- `select id, share_token into v_new_id, v_token from challenges where
-- ...` sin calificar la tabla -- `share_token` ahí es ambiguo entre la
-- variable de salida y la columna `challenges.share_token`, y Postgres
-- lo rechaza con 42702 en cuanto esa rama del código se ejecuta (que es
-- SIEMPRE, es el primer SELECT real de la función). `id` en la misma
-- línea no tiene el mismo problema (no hay ninguna variable de salida
-- llamada `id`), por eso el error señala puntualmente a `share_token`.
--
-- Auditado también dentro de esta misma función: la única otra
-- ocurrencia de `share_token` es en la lista de columnas de un INSERT
-- (`insert into challenges (share_token, ...)`) -- ahí Postgres siempre
-- resuelve contra las columnas de la tabla destino, nunca contra
-- variables, así que no comparte el bug. Ninguna otra referencia sin
-- calificar a `challenge_id`/`ok`/`error_code` existe en el cuerpo de la
-- función (los demás usos son literales en `return query select ...` o
-- ya vienen de variables como v_new_id/v_token). Se revisaron también
-- respond_direct_challenge()/accept_challenge() (mismo patrón de
-- columnas de retorno) -- ninguna de las dos tiene una colisión de
-- nombre equivalente en su cuerpo actual, así que no se tocan.
--
-- Corrección mínima: alias `c` sobre `challenges` en ese único SELECT,
-- calificando `c.id`/`c.share_token`/`c.from_user_id`/
-- `c.target_user_id`/`c.status`. Ninguna otra línea de la función
-- cambia -- mismo bono de idempotencia, misma validación de scan, mismo
-- INSERT, misma notificación aislada en su propio BEGIN/EXCEPTION.

create or replace function public.create_direct_challenge(p_source_scan_id uuid, p_target_username text)
returns table (challenge_id uuid, share_token text, ok boolean, error_code text)
language plpgsql
security definer set search_path = public, extensions
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
  --
  -- Fix 42702 (bug real de producción, ver comentario de la migración):
  -- `c` calificando cada columna -- `share_token` sin calificar era
  -- ambiguo contra la variable de salida `share_token` de esta misma
  -- función.
  select c.id, c.share_token into v_new_id, v_token
  from challenges c
  where c.from_user_id = v_uid and c.target_user_id = v_target_id and c.status = 'pending'
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
