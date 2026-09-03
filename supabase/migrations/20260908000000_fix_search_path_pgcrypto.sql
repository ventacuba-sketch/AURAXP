-- Fix: signup real roto en producción -- "function gen_random_bytes(integer)
-- does not exist" (SQLSTATE 42883), confirmado en los logs de Auth durante
-- un registro real. Causa: `create_wallet_for_new_profile()` está declarada
-- `security definer set search_path = public` -- ese SET reemplaza (no
-- extiende) el search_path ambiente para la ejecución de la función, así
-- que aunque pgcrypto está instalada (gen_random_uuid() funciona en todos
-- lados como DEFAULT de columna, porque esos sí usan el search_path
-- ambiente de la sesión) esta función puntual no encuentra
-- gen_random_bytes -- típicamente vive en el esquema `extensions` en
-- proyectos Supabase-hosted, no en `public`.
--
-- Corrección mínima: agregar `extensions` al search_path de esta función.
-- Ninguna otra línea cambia -- mismo bono de signup (+1000 Coins), mismo
-- insert a wallets/coin_transactions/analytics_events, mismo loop de
-- generación/reintento de referral_code (8 hex mayúsculas).
--
-- Mismo patrón, mismo riesgo latente (no reportado como roto todavía, pero
-- idéntica causa posible) en `create_direct_challenge()` -- comparte
-- `security definer set search_path = public` + gen_random_bytes(5) para
-- el share_token. Se corrige acá también, preventivo, sin tocar ninguna
-- otra línea de su lógica (validaciones, idempotencia del pending
-- duplicado, notificación best-effort, etc.).
--
-- CREATE OR REPLACE FUNCTION exige el cuerpo completo -- se repite tal
-- cual el de las migraciones originales (20260905000000 y 20260903000000),
-- cambiando únicamente la cláusula `set search_path`.

create or replace function public.create_wallet_for_new_profile()
returns trigger
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_code text;
  v_attempts int := 0;
begin
  insert into wallets (user_id, balance) values (new.id, 1000);
  insert into coin_transactions (user_id, amount, balance_after, type)
  values (new.id, 1000, 1000, 'signup_bonus');

  begin
    insert into analytics_events (event_name, user_id) values ('wallet_created', new.id);
  exception when others then
    raise warning 'create_wallet_for_new_profile: analytics failed for %: %', new.id, sqlerrm;
  end;

  -- Reintenta si el código choca (8 hex mayúsculas -- colisión
  -- extremadamente improbable, pero nunca debe poder tumbar el signup).
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    begin
      update profiles set referral_code = v_code where id = new.id;
      exit;
    exception when unique_violation then
      if v_attempts > 20 then exit; end if;
    end;
  end loop;

  return new;
end;
$$;

revoke execute on function public.create_wallet_for_new_profile() from public, anon, authenticated;

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
