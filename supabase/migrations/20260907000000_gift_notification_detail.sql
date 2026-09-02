-- Bug UX: la notificación gift_received solo decía "@user te mandó un
-- regalo" -- nunca CUÁL, y al tocarla se iba al perfil del remitente sin
-- mostrar el regalo en ningún lado. Causa real: la notificación nunca
-- guardaba una referencia al regalo, solo `rival_user_id` -- el dato
-- exacto (gift_key) vive en `gifts`, pero no había forma de saber CUÁL
-- fila de esa tabla corresponde a esta notificación puntual (alguien
-- puede haber mandado más de un regalo).
--
-- NO toca la lógica económica: `apply_coin_transaction`/`send_gift` para
-- el cobro del remitente siguen exactamente igual, y el receptor sigue
-- sin recibir Coins (nunca los recibió -- ver esa función, un regalo es
-- 100% cosmético/social). Esto solo agrega la referencia para poder
-- MOSTRAR el regalo correcto, nada de dinero.
--
-- Idempotente: columna con IF NOT EXISTS, función con CREATE OR REPLACE.

alter table notifications add column if not exists gift_id uuid references gifts(id) on delete set null;

-- Reescribe send_gift() -- único cambio real: la notificación ahora
-- guarda gift_id = v_gift_id (ya se calculaba antes de este punto, no
-- hace falta ninguna consulta nueva). Todo lo demás es idéntico a la
-- versión anterior (20260905010000).
create or replace function public.send_gift(p_recipient_username text, p_gift_key text, p_idempotency_key text default null)
returns table (ok boolean, error_code text, new_balance bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recipient_id uuid;
  v_item store_items%rowtype;
  v_tx record;
  v_gift_id uuid;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::bigint;
    return;
  end if;

  select id into v_recipient_id from profiles where lower(username) = lower(p_recipient_username);
  if v_recipient_id is null then
    return query select false, 'recipient_not_found', null::bigint;
    return;
  end if;
  if v_uid = v_recipient_id then
    return query select false, 'cannot_gift_self', null::bigint;
    return;
  end if;

  select * into v_item from store_items where item_key = p_gift_key and active and category = 'gift';
  if not found then
    return query select false, 'item_not_found', null::bigint;
    return;
  end if;

  select * into v_tx from apply_coin_transaction(v_uid, -v_item.price_coins, 'gift_sent', 'gifts', null, p_idempotency_key);
  if not v_tx.ok then
    return query select false, coalesce(v_tx.error_code, 'send_failed'), v_tx.new_balance;
    return;
  end if;

  select id into v_gift_id from gifts where transaction_id = v_tx.transaction_id;
  if v_gift_id is not null then
    return query select true, null::text, v_tx.new_balance;
    return;
  end if;

  insert into gifts (sender_id, recipient_id, gift_key, coins_cost, transaction_id)
  values (v_uid, v_recipient_id, p_gift_key, v_item.price_coins, v_tx.transaction_id)
  returning id into v_gift_id;

  begin
    -- Único cambio real de esta migración: gift_id = v_gift_id (antes
    -- ausente) -- así el cliente puede resolver el regalo EXACTO en vez
    -- de adivinar "el último que mandó esta persona".
    insert into notifications (user_id, kind, rival_user_id, gift_id) values (v_recipient_id, 'gift_received', v_uid, v_gift_id);
  exception when others then
    raise warning 'send_gift: notification failed for gift %: %', v_gift_id, sqlerrm;
  end;

  begin
    insert into analytics_events (event_name, user_id, metadata) values
      ('gift_sent', v_uid, jsonb_build_object('gift_key', p_gift_key, 'recipient_id', v_recipient_id)),
      ('gift_received', v_recipient_id, jsonb_build_object('gift_key', p_gift_key, 'sender_id', v_uid));
  exception when others then
    raise warning 'send_gift: analytics failed for gift %: %', v_gift_id, sqlerrm;
  end;

  return query select true, null::text, v_tx.new_balance;
end;
$$;

revoke execute on function public.send_gift(text, text, text) from public, anon;
grant execute on function public.send_gift(text, text, text) to authenticated;
