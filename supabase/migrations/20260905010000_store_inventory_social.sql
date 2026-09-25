-- Bloque (cont.): Tienda + Inventario/Equipamiento + Regalos + Follow +
-- Reportar bug. Depende de wallets/apply_coin_transaction (migración
-- anterior). `battle_id` en `gifts` queda nullable y sin usar todavía --
-- preparación explícita para Group Battles/AURA LIVE (Q16), no una
-- feature nueva a medio construir.
--
-- NOTA (re-alineación con producción, auditoría posterior): producción
-- ya tiene este bloque aplicado -- vía una migración equivalente
-- endurecida -- con CORRECCIONES sobre lo que había acá originalmente.
-- Esta migración se reescribió para (1) ser 100% idempotente contra una
-- base que YA tiene estos objetos (CREATE TABLE/INDEX IF NOT EXISTS,
-- políticas con DROP POLICY IF EXISTS + CREATE POLICY, ADD COLUMN IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION/VIEW) y (2) incorporar esas
-- correcciones, para que una base NUEVA termine exactamente en el mismo
-- estado que producción:
--   - inventory_items tiene ahora purchase_transaction_id (referencia
--     única a la coin_transaction que pagó ese objeto) y purchase_store_
--     item() lo usa para no crear un SEGUNDO inventory_item si un retry
--     idempotente vuelve a pasar por acá (apply_coin_transaction ya
--     protege el cobro; esto protege la ENTREGA del objeto).
--   - gifts tiene ahora transaction_id con el mismo propósito, y
--     send_gift() sigue el mismo patrón: un retry nunca crea un segundo
--     regalo ni vuelve a notificar/loguear.
--   - follow_user() revisa ROW_COUNT después del INSERT ... ON CONFLICT
--     DO NOTHING: si el follow ya existía, devuelve éxito sin volver a
--     insertar notification/analytics (antes los insertaba SIEMPRE,
--     incluso en un re-follow que no cambió nada).
--   - public_equipped_items ahora es security_invoker=true, así que un
--     SELECT directo del cliente (no vía get_public_equipped) respeta la
--     RLS real de equipped_items (auth.uid() = user_id) en vez de
--     bypasearla como dueño de la vista -- cierra la exposición
--     potencial de equipped_items de OTRO usuario si alguna vez se
--     conociera su id crudo.
--   - Los RPC internos/privados quedan con su EXECUTE revocado de
--     public/anon explícitamente.
--   - Texto de catálogo: las dos descripciones que decían "AURAXP" pasan
--     a decir "AURA VS" (el ON CONFLICT sigue siendo DO NOTHING -- ver
--     el informe de esta tarea sobre por qué esto no reescribe filas ya
--     sembradas en producción).

-- ============================================================
-- A) Tienda
-- ============================================================
create table if not exists store_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  category text not null check (category in ('consumable', 'gift', 'effect', 'cosmetic', 'aspirational')),
  name text not null,
  description text,
  price_coins int not null check (price_coins > 0),
  item_type text not null check (item_type in ('consumable', 'permanent')),
  -- Solo permanentes equipables lo usan (cosméticos/efectos) -- null para
  -- consumibles y regalos, que no se "equipan".
  equip_slot text check (equip_slot in ('profile_frame', 'result_effect', 'badge', 'vs_effect')),
  -- Referencia visual liviana (emoji/hex) -- no hay pipeline de assets
  -- nuevo todavía, ver reporte.
  asset_ref text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists store_items_category_idx on store_items (category, sort_order) where active;

alter table store_items enable row level security;
drop policy if exists "store_items_select_active" on store_items;
create policy "store_items_select_active" on store_items for select using (active);
grant select on store_items to authenticated;

-- Catálogo semilla real (no un placeholder vacío) -- cubre las 5
-- categorías y sus rangos de precio pedidos, con al menos un objeto
-- aspiracional caro y deseable desde el día uno. ON CONFLICT DO NOTHING:
-- nunca pisa una fila ya sembrada (incluye ediciones manuales de precio/
-- catálogo que se hayan hecho en producción desde que corrió la primera
-- vez) -- ver la nota de arriba sobre las dos descripciones que ya
-- estaban sembradas con el texto viejo "AURAXP" en producción.
insert into store_items (item_key, category, name, description, price_coins, item_type, equip_slot, asset_ref, sort_order) values
  ('confetti_boost', 'consumable', 'Boost de Confeti', 'Un efecto extra en tu próximo resultado.', 500, 'consumable', null, '🎉', 10),
  ('gift_clap', 'gift', 'Aplausos', 'Mándale un aplauso a alguien.', 2000, 'consumable', null, '👏', 20),
  ('gift_fire', 'gift', 'Fuego', 'Reconoce un resultado que valió la pena.', 3000, 'consumable', null, '🔥', 21),
  ('gift_diamond', 'gift', 'Diamante', 'El regalo más top de AURA VS.', 5000, 'consumable', null, '💎', 22),
  ('effect_golden_aura', 'effect', 'Aura Dorada', 'Tu resultado brilla distinto.', 8000, 'permanent', 'result_effect', '✨', 30),
  ('effect_vs_spark', 'effect', 'Chispa VS', 'Un acento propio en cada Challenge.', 12000, 'permanent', 'vs_effect', '⚡', 31),
  ('cosmetic_neon_frame', 'cosmetic', 'Marco Neón', 'Un marco propio para tu avatar.', 25000, 'permanent', 'profile_frame', '🟢', 40),
  ('cosmetic_founder_badge', 'cosmetic', 'Insignia Fundador', 'Mostrá que estuviste desde temprano.', 35000, 'permanent', 'badge', '🏅', 41),
  ('aspirational_legend_crown', 'aspirational', 'Corona Legendaria', 'El objeto más exclusivo de AURA VS.', 120000, 'permanent', 'badge', '👑', 50)
on conflict (item_key) do nothing;

-- ============================================================
-- B) Inventario + equipamiento
-- ============================================================
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  store_item_id uuid not null references store_items(id),
  acquired_at timestamptz not null default now(),
  -- Solo aplica a consumibles -- null mientras no se use.
  consumed_at timestamptz,
  -- CORRECCIÓN (auditoría): referencia única a la coin_transaction que
  -- pagó este objeto -- purchase_store_item() la usa para no entregar un
  -- segundo objeto si un retry idempotente vuelve a pasar por la misma
  -- transacción (ver esa función más abajo).
  purchase_transaction_id uuid unique references coin_transactions(id)
);

-- Por si la tabla ya existía sin esta columna (entorno parcialmente
-- migrado) -- no-op si ya está, como en producción.
alter table inventory_items add column if not exists purchase_transaction_id uuid unique references coin_transactions(id);

create index if not exists inventory_items_user_id_idx on inventory_items (user_id);

alter table inventory_items enable row level security;
drop policy if exists "inventory_items_select_own" on inventory_items;
create policy "inventory_items_select_own" on inventory_items for select using (auth.uid() = user_id);
grant select on inventory_items to authenticated;

create table if not exists equipped_items (
  user_id uuid not null references profiles(id) on delete cascade,
  slot text not null check (slot in ('profile_frame', 'result_effect', 'badge', 'vs_effect')),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  equipped_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table equipped_items enable row level security;
drop policy if exists "equipped_items_select_own" on equipped_items;
create policy "equipped_items_select_own" on equipped_items for select using (auth.uid() = user_id);
grant select on equipped_items to authenticated;

-- Vista pública mínima (mismo patrón que public_profiles): lo único que
-- otro usuario necesita ver de lo que alguien tiene equipado (perfil
-- público con marco/insignia visibles) -- nunca la tabla cruda completa.
--
-- CORRECCIÓN (auditoría): security_invoker=true -- antes la vista corría
-- con los privilegios de su dueño (el rol de las migraciones), lo que en
-- los hechos bypaseaba la RLS real de equipped_items para CUALQUIER
-- SELECT directo del cliente, no solo para el propio usuario. Con
-- security_invoker=true, un SELECT directo (walletService.fetchMyEquipped,
-- que ya filtra por su propio user_id) respeta la policy real
-- (auth.uid() = user_id) -- sigue funcionando igual para uno mismo, pero
-- ya no expone la fila de otro usuario aunque alguien conociera su id
-- crudo. get_public_equipped() (más abajo) no se ve afectada: corre
-- SECURITY DEFINER, así que el dueño de esa función sigue viendo todas
-- las filas sin pasar por RLS, que es justamente su propósito.
create or replace view public_equipped_items with (security_invoker = true) as
  select ei.user_id, ei.slot, si.item_key, si.asset_ref, si.name
  from equipped_items ei
  join store_items si on si.id = (select store_item_id from inventory_items ii where ii.id = ei.inventory_item_id);

-- Grant a la vista SOLO tiene sentido para el propio usuario, que ya
-- conoce su propio id (session.user.id) sin necesitar exponerlo -- para
-- OTRO perfil (PublicProfileScreen) el cliente nunca tiene un id crudo,
-- así que hace falta una función que resuelva por username, igual que
-- get_public_follow_stats.
grant select on public_equipped_items to authenticated;

create or replace function public.get_public_equipped(p_username text)
returns table (slot text, item_key text, asset_ref text, name text)
language sql
security definer set search_path = public
stable
as $$
  select pei.slot, pei.item_key, pei.asset_ref, pei.name
  from public_equipped_items pei
  join profiles p on lower(p.username) = lower(p_username)
  where pei.user_id = p.id;
$$;

-- "authenticated sí, anon no" -- mismo criterio que el resto de RPCs de
-- perfil público de este bloque (get_public_follow_stats/get_followers_
-- list/get_following_list).
revoke execute on function public.get_public_equipped(text) from public, anon;
grant execute on function public.get_public_equipped(text) to authenticated;

-- CORRECCIÓN (auditoría): idempotencia real a nivel del OBJETO
-- entregado, no solo del cobro. apply_coin_transaction() ya garantiza
-- que un retry con la misma idempotency_key no vuelve a cobrar -- pero
-- sin este chequeo, un retry (misma key) igual insertaba un SEGUNDO
-- inventory_item para la misma compra. Ahora: después de cobrar, se
-- busca primero si ya existe un inventory_item para esa transaction_id
-- exacta; si existe, se devuelve ESE (nunca se crea otro).
create or replace function public.purchase_store_item(p_item_key text, p_idempotency_key text default null)
returns table (ok boolean, error_code text, inventory_item_id uuid, new_balance bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item store_items%rowtype;
  v_tx record;
  v_inv_id uuid;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::bigint;
    return;
  end if;

  -- category <> 'gift': los regalos se compran/envían en un solo paso
  -- vía send_gift(), nunca quedan en inventario propio.
  select * into v_item from store_items where item_key = p_item_key and active and category <> 'gift';
  if not found then
    return query select false, 'item_not_found', null::uuid, null::bigint;
    return;
  end if;

  select * into v_tx from apply_coin_transaction(v_uid, -v_item.price_coins, 'store_purchase', 'store_items', v_item.id, p_idempotency_key);
  if not v_tx.ok then
    return query select false, coalesce(v_tx.error_code, 'purchase_failed'), null::uuid, v_tx.new_balance;
    return;
  end if;

  select id into v_inv_id from inventory_items where purchase_transaction_id = v_tx.transaction_id;
  if v_inv_id is not null then
    return query select true, null::text, v_inv_id, v_tx.new_balance;
    return;
  end if;

  insert into inventory_items (user_id, store_item_id, purchase_transaction_id)
  values (v_uid, v_item.id, v_tx.transaction_id)
  returning id into v_inv_id;

  begin
    insert into analytics_events (event_name, user_id, metadata)
    values ('item_purchased', v_uid, jsonb_build_object('item_key', p_item_key, 'price_coins', v_item.price_coins));
  exception when others then
    raise warning 'purchase_store_item: analytics failed for %/%: %', v_uid, p_item_key, sqlerrm;
  end;

  return query select true, null::text, v_inv_id, v_tx.new_balance;
end;
$$;

-- "authenticated sí, anon no" -- Store RPC.
revoke execute on function public.purchase_store_item(text, text) from public, anon;
grant execute on function public.purchase_store_item(text, text) to authenticated;

-- "No permitir equipar algo que no se posee" -- el JOIN exige
-- ii.user_id = v_uid, así que un inventory_item_id ajeno o inexistente
-- simplemente no resuelve ningún slot.
create or replace function public.equip_item(p_inventory_item_id uuid)
returns table (ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slot text;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select si.equip_slot into v_slot
  from inventory_items ii
  join store_items si on si.id = ii.store_item_id
  where ii.id = p_inventory_item_id and ii.user_id = v_uid and ii.consumed_at is null;

  if v_slot is null then
    return query select false, 'not_owned';
    return;
  end if;

  insert into equipped_items (user_id, slot, inventory_item_id)
  values (v_uid, v_slot, p_inventory_item_id)
  on conflict (user_id, slot) do update set inventory_item_id = excluded.inventory_item_id, equipped_at = now();

  return query select true, null::text;
end;
$$;

-- "authenticated sí, anon no" -- Store RPC.
revoke execute on function public.equip_item(uuid) from public, anon;
grant execute on function public.equip_item(uuid) to authenticated;

create or replace function public.unequip_item(p_slot text)
returns table (ok boolean)
language plpgsql
security definer set search_path = public
as $$
begin
  delete from equipped_items where user_id = auth.uid() and slot = p_slot;
  return query select true;
end;
$$;

-- "authenticated sí, anon no" -- Store RPC.
revoke execute on function public.unequip_item(text) from public, anon;
grant execute on function public.unequip_item(text) to authenticated;

-- ============================================================
-- C) Regalos -- consumen Coins, nunca Aura/XP/votos
-- ============================================================
create table if not exists gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  gift_key text not null,
  coins_cost int not null,
  -- Preparación para Group Battles/AURA LIVE (Q16) -- nullable, sin usar
  -- todavía: cuando exista una tabla battles/live_events, un regalo
  -- mandado DURANTE una batalla completa este campo; uno mandado a un
  -- perfil normal lo deja null. Ningún rework de esta tabla hace falta
  -- para ese día.
  battle_id uuid,
  -- CORRECCIÓN (auditoría): referencia única a la coin_transaction que
  -- pagó este regalo -- send_gift() la usa para no crear un segundo
  -- regalo (ni volver a notificar) si un retry idempotente vuelve a
  -- pasar por la misma transacción.
  transaction_id uuid unique references coin_transactions(id),
  created_at timestamptz not null default now(),
  constraint gifts_no_self check (sender_id <> recipient_id)
);

-- Por si la tabla ya existía sin esta columna -- no-op si ya está.
alter table gifts add column if not exists transaction_id uuid unique references coin_transactions(id);

create index if not exists gifts_recipient_id_idx on gifts (recipient_id, created_at desc);
create index if not exists gifts_sender_id_idx on gifts (sender_id, created_at desc);

alter table gifts enable row level security;
drop policy if exists "gifts_select_involved" on gifts;
create policy "gifts_select_involved" on gifts for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
grant select on gifts to authenticated;

-- p_recipient_username, NO un uuid crudo (H) -- get_public_profile nunca
-- expone el id técnico de nadie (ver ese comentario/precedente), así que
-- el cliente jamás lo tiene para pasar acá. Se resuelve adentro, mismo
-- criterio que create_direct_challenge(p_target_username).
--
-- CORRECCIÓN (auditoría): mismo patrón que purchase_store_item -- un
-- retry con la misma idempotency_key no debe crear un segundo gift ni
-- volver a notificar/loguear analytics. Se busca primero si ya existe un
-- gift para esa transaction_id exacta.
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
    insert into notifications (user_id, kind, rival_user_id) values (v_recipient_id, 'gift_received', v_uid);
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

-- "authenticated sí, anon no" -- Gift RPC.
revoke execute on function public.send_gift(text, text, text) from public, anon;
grant execute on function public.send_gift(text, text, text) to authenticated;

-- ============================================================
-- D) Follow / Following -- grafo social, sin Aura/XP
-- ============================================================
create table if not exists follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

create index if not exists follows_followee_id_idx on follows (followee_id);

alter table follows enable row level security;
-- Sin ninguna policy/GRANT de select a propósito: get_public_follow_stats/
-- get_followers_list/get_following_list (más abajo, todas SECURITY
-- DEFINER) son el ÚNICO camino de lectura -- cubren todo lo que el
-- cliente necesita sin exponer nunca un id crudo (mismo principio que
-- get_public_profile en toda esta app). Sin GRANT, ninguna policy acá
-- importaría igual -- Postgres exige el GRANT antes de evaluar RLS.

-- p_target_username (H, mismo motivo que send_gift): get_public_profile
-- nunca expone un id técnico, así que el cliente nunca lo tiene.
--
-- CORRECCIÓN (auditoría): revisa ROW_COUNT después del INSERT ... ON
-- CONFLICT DO NOTHING -- si el follow YA existía, devuelve éxito de
-- inmediato sin insertar una segunda notification ni un segundo evento
-- de analytics (antes los insertaba siempre, incluso en un re-follow que
-- en los hechos no cambió nada).
create or replace function public.follow_user(p_target_username text)
returns table (ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
  v_row_count int;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select id into v_target_id from profiles where lower(username) = lower(p_target_username);
  if v_target_id is null then
    return query select false, 'target_not_found';
    return;
  end if;
  if v_uid = v_target_id then
    return query select false, 'cannot_follow_self';
    return;
  end if;

  insert into follows (follower_id, followee_id) values (v_uid, v_target_id)
  on conflict (follower_id, followee_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Ya lo seguía -- idempotente: éxito real, pero sin duplicar
    -- notificación ni analytics de un follow que ya existía.
    return query select true, null::text;
    return;
  end if;

  begin
    insert into notifications (user_id, kind, rival_user_id) values (v_target_id, 'new_follower', v_uid);
  exception when others then
    raise warning 'follow_user: notification failed for %/%: %', v_uid, v_target_id, sqlerrm;
  end;

  begin
    insert into analytics_events (event_name, user_id, metadata) values ('follow', v_uid, jsonb_build_object('target_id', v_target_id));
  exception when others then
    raise warning 'follow_user: analytics failed for %/%: %', v_uid, v_target_id, sqlerrm;
  end;

  return query select true, null::text;
end;
$$;

-- "authenticated sí, anon no" -- Follow RPC.
revoke execute on function public.follow_user(text) from public, anon;
grant execute on function public.follow_user(text) to authenticated;

create or replace function public.unfollow_user(p_target_username text)
returns table (ok boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_target_id uuid;
begin
  select id into v_target_id from profiles where lower(username) = lower(p_target_username);
  if v_target_id is not null then
    delete from follows where follower_id = auth.uid() and followee_id = v_target_id;
  end if;
  return query select true;
end;
$$;

-- "authenticated sí, anon no" -- Follow RPC.
revoke execute on function public.unfollow_user(text) from public, anon;
grant execute on function public.unfollow_user(text) to authenticated;

-- Contadores + "¿lo sigo?" de un perfil público -- sin exponer ids
-- crudos, mismo criterio que get_public_profile.
create or replace function public.get_public_follow_stats(p_username text)
returns table (followers_count int, following_count int, is_following boolean)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_target_id uuid;
begin
  select id into v_target_id from profiles where lower(username) = lower(p_username);
  if v_target_id is null then
    return query select 0, 0, false;
    return;
  end if;

  return query select
    (select count(*)::int from follows where followee_id = v_target_id),
    (select count(*)::int from follows where follower_id = v_target_id),
    (auth.uid() is not null and exists (select 1 from follows where follower_id = auth.uid() and followee_id = v_target_id));
end;
$$;

-- "authenticated sí, anon no" -- Follow RPC.
revoke execute on function public.get_public_follow_stats(text) from public, anon;
grant execute on function public.get_public_follow_stats(text) to authenticated;

-- Listados -- mismos campos públicos que get_public_profile (username,
-- avatar, nivel), nunca un id. LIMIT fijo: sin paginación todavía, ver
-- reporte (alcance razonable para el tamaño de red social actual).
create or replace function public.get_followers_list(p_username text)
returns table (username text, avatar_emoji text, level int)
language sql
security definer set search_path = public
stable
as $$
  select p.username, p.avatar_emoji, p.level
  from follows f
  join profiles p on p.id = f.follower_id
  join profiles target on lower(target.username) = lower(p_username)
  where f.followee_id = target.id
  order by f.created_at desc
  limit 50;
$$;

-- "authenticated sí, anon no" -- Follow RPC.
revoke execute on function public.get_followers_list(text) from public, anon;
grant execute on function public.get_followers_list(text) to authenticated;

create or replace function public.get_following_list(p_username text)
returns table (username text, avatar_emoji text, level int)
language sql
security definer set search_path = public
stable
as $$
  select p.username, p.avatar_emoji, p.level
  from follows f
  join profiles p on p.id = f.followee_id
  join profiles source on lower(source.username) = lower(p_username)
  where f.follower_id = source.id
  order by f.created_at desc
  limit 50;
$$;

-- "authenticated sí, anon no" -- Follow RPC.
revoke execute on function public.get_following_list(text) from public, anon;
grant execute on function public.get_following_list(text) to authenticated;

-- ============================================================
-- E) Reportar bug / sugerencia
-- ============================================================
create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  kind text not null check (kind in ('bug', 'suggestion', 'other')),
  message text not null,
  -- Contexto útil automático (pantalla, plataforma, user agent) -- nunca
  -- nada más sensible que eso.
  context jsonb,
  created_at timestamptz not null default now()
);

alter table bug_reports enable row level security;
drop policy if exists "bug_reports_insert_own" on bug_reports;
create policy "bug_reports_insert_own" on bug_reports for insert with check (auth.uid() = user_id or user_id is null);
grant insert on bug_reports to authenticated;
-- Sin policy de SELECT para nadie del lado del cliente a propósito --
-- panel de soporte futuro lee con service_role (ver reporte).
