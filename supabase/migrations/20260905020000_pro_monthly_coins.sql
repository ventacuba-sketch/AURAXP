-- Bloque (cont.): PRO obtiene ~5.000 Coins/mes, sin doble acreditación.
-- Se integra al mecanismo YA existente (sync-pro-subscriptions,
-- activateProfile()) -- sin crear un cron ni un sistema paralelo. Ver
-- ese archivo: se llama desde ahí, una vez por cada sync (hasta cada
-- hora una vez que el cron esté vivo -- ver auditoría de dLocal del
-- bloque anterior), y esta función decide sola si ya corresponde o no.
--
-- NOTA (re-alineación con producción, auditoría posterior): producción
-- ya tiene este bloque aplicado -- vía una migración equivalente. Esta
-- migración se reescribió solo para ser idempotente (ADD COLUMN IF NOT
-- EXISTS) contra una base que ya tiene la columna; la función en sí no
-- tuvo correcciones (ya bloqueaba la fila con FOR UPDATE y ya tenía su
-- EXECUTE revocado de public/anon/authenticated desde el principio).

alter table profiles add column if not exists pro_coins_credited_month text;

create or replace function public.credit_pro_monthly_coins(p_user_id uuid)
returns table (ok boolean, credited boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_already text;
  v_tx record;
begin
  select pro_coins_credited_month into v_already from profiles where id = p_user_id for update;

  -- Ya se acreditó este mes calendario (UTC) -- no-op real, no un error:
  -- sync-pro-subscriptions puede llamar esto muchas veces por mes (cada
  -- sync), es justamente lo que evita el doble pago.
  if v_already = v_month then
    return query select true, false;
    return;
  end if;

  select * into v_tx from apply_coin_transaction(
    p_user_id, 5000, 'pro_monthly_bonus', 'profiles', p_user_id,
    'pro_monthly_' || p_user_id::text || '_' || v_month
  );
  if not v_tx.ok then
    return query select false, false;
    return;
  end if;

  update profiles set pro_coins_credited_month = v_month where id = p_user_id;
  return query select true, true;
end;
$$;

-- Solo alcanzable server-side (sync-pro-subscriptions corre con
-- service_role, que ignora este REVOKE) -- ningún cliente debe poder
-- pedir su propio crédito mensual a mano, aunque la idempotencia de
-- arriba lo dejaría inofensivo igual; mismo criterio que
-- find_profile_id_by_email.
revoke execute on function public.credit_pro_monthly_coins(uuid) from public, anon, authenticated;
