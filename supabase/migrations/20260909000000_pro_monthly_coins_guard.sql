-- Bug crítico confirmado (auditoría): credit_pro_monthly_coins() nunca
-- validaba que el perfil fuera realmente PRO activo antes de acreditar
-- los 5.000 Coins mensuales -- solo chequeaba `pro_coins_credited_month`
-- contra el mes calendario actual. En la práctica, esta función tiene un
-- único caller en todo el código (activateProfile(), en
-- sync-pro-subscriptions/index.ts), que SIEMPRE la llama después de
-- poner plan='pro'/pro_status='active' en el mismo profile -- así que el
-- guard nunca hizo falta en el camino normal. Un usuario FREE real (una
-- cuenta nueva de prueba de referidos) terminó con +5.000 Coins
-- 'pro_monthly_bonus' sin que su perfil tenga ningún rastro de haber
-- pasado por activateProfile() (plan sigue 'free', pro_status y
-- pro_subscription_id siguen null) -- consistente con una invocación
-- directa de esta función (p.ej. desde el SQL editor) contra el user_id
-- equivocado, no con un bug del camino normal de sync-pro-subscriptions.
-- De cualquier forma, la función en sí debe blindarse: nunca debe poder
-- acreditar el bono PRO a nadie que no sea realmente plan='pro' AND
-- pro_status='active' en el momento de la llamada, sea cual sea el
-- origen de esa llamada.
--
-- Único cambio real: un guard adicional, mismo criterio "no-op real, no
-- un error" que ya usa el guard de "ya se acreditó este mes" (ok:true,
-- credited:false) -- se lee en el mismo SELECT ... FOR UPDATE que ya
-- bloqueaba la fila, sin un segundo round-trip. Ninguna otra línea de
-- lógica cambia: mismo monto (5000), mismo tipo ('pro_monthly_bonus'),
-- misma idempotencia mensual vía pro_coins_credited_month, misma
-- referencia idempotente en apply_coin_transaction, mismo REVOKE de
-- EXECUTE. No toca signup_bonus, referral_referrer_bonus,
-- referral_referred_bonus, ni ninguna otra función.

create or replace function public.credit_pro_monthly_coins(p_user_id uuid)
returns table (ok boolean, credited boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_already text;
  v_plan text;
  v_pro_status text;
  v_tx record;
begin
  select pro_coins_credited_month, plan, pro_status
    into v_already, v_plan, v_pro_status
    from profiles where id = p_user_id for update;

  -- Guard nuevo (bug confirmado, auditoría) -- nunca acreditar el bono
  -- mensual de PRO a una cuenta que no sea realmente PRO activa ahora
  -- mismo, sin importar quién o qué haya llamado a esta función.
  if v_plan is distinct from 'pro' or v_pro_status is distinct from 'active' then
    return query select true, false;
    return;
  end if;

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

revoke execute on function public.credit_pro_monthly_coins(uuid) from public, anon, authenticated;
