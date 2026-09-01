import { getSession } from './authService';
import { supabase } from './supabaseClient';

/**
 * Cliente del bloque Wallet/Coins -- capa fina sobre las RPCs reales (ver
 * las migraciones 20260905*). Nunca calcula ni asume un saldo acá: todo
 * lo económico sale de apply_coin_transaction() server-side; esto solo
 * lee/pide, nunca decide.
 */

export interface Wallet {
  balance: number;
}

export async function fetchWallet(): Promise<Wallet | null> {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle();
  if (error || !data) return null;
  return { balance: Number(data.balance) };
}

export interface CoinTransaction {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  createdAt: string;
}

const TX_PAGE_SIZE = 30;

export async function fetchTransactionHistory(offset = 0): Promise<CoinTransaction[]> {
  if (!supabase) return [];
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('coin_transactions')
    .select('id, amount, balance_after, type, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + TX_PAGE_SIZE - 1);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    type: r.type,
    createdAt: r.created_at,
  }));
}

export type MissionKey = 'scan' | 'challenge' | 'share' | 'streak';

/** Coins que otorga cada misión -- deben coincidir con lo que realmente
 * paga claim_mission_reward() server-side (ver la migración); esto es
 * SOLO para mostrar el número en la UI antes de reclamar, el server
 * jamás confía en este valor. 'streak' es variable (min(racha,5)*10,
 * tope 50) así que no tiene un monto fijo acá. */
export const MISSION_COINS: Record<Exclude<MissionKey, 'streak'>, number> = {
  scan: 100,
  challenge: 150,
  share: 100,
};

/** Qué misiones ya reclamé HOY (server timezone/UTC, ver mission_claims) --
 * para no ofrecer "RECLAMAR" de nuevo en una misión ya cobrada tras un
 * refresh (el RPC igual lo rechazaría con 'already_claimed', pero mostrar
 * el botón sería confuso). */
export async function fetchClaimedMissionsToday(): Promise<Record<MissionKey, boolean>> {
  const empty: Record<MissionKey, boolean> = { scan: false, challenge: false, share: false, streak: false };
  if (!supabase) return empty;
  const session = await getSession();
  if (!session) return empty;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('mission_claims')
    .select('mission_key')
    .eq('user_id', session.user.id)
    .gte('day', todayStart.toISOString().slice(0, 10));
  if (error || !data) return empty;
  const result = { ...empty };
  for (const row of data) result[row.mission_key as MissionKey] = true;
  return result;
}

export interface ClaimMissionResult {
  ok: boolean;
  coinsAwarded: number;
  errorCode?: string;
}

/** Re-valida la condición server-side (nunca confía en lo que el cliente
 * "cree" que ya cumplió) -- ver claim_mission_reward en la migración. */
export async function claimMissionReward(key: MissionKey): Promise<ClaimMissionResult> {
  if (!supabase) return { ok: false, coinsAwarded: 0, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('claim_mission_reward', { p_mission_key: key });
  if (error) {
    console.error(JSON.stringify({ src: 'claimMissionReward', event: 'rpc_error', key, message: error.message }));
    return { ok: false, coinsAwarded: 0, errorCode: 'rpc_error' };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, coinsAwarded: 0, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), coinsAwarded: Number(row.coins_awarded ?? 0), errorCode: row.error_code ?? undefined };
}

export interface StoreItem {
  itemKey: string;
  category: 'consumable' | 'gift' | 'effect' | 'cosmetic' | 'aspirational';
  name: string;
  description: string | null;
  priceCoins: number;
  itemType: 'consumable' | 'permanent';
  equipSlot: EquipSlot | null;
  assetRef: string | null;
}

export type EquipSlot = 'profile_frame' | 'result_effect' | 'badge' | 'vs_effect';

export async function fetchStoreItems(): Promise<StoreItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('store_items')
    .select('item_key, category, name, description, price_coins, item_type, equip_slot, asset_ref')
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    itemKey: r.item_key,
    category: r.category,
    name: r.name,
    description: r.description,
    priceCoins: Number(r.price_coins),
    itemType: r.item_type,
    equipSlot: r.equip_slot,
    assetRef: r.asset_ref,
  }));
}

export interface PurchaseResult {
  ok: boolean;
  errorCode?: string;
  newBalance?: number;
}

/** idempotencyKey: generado por el caller (un uuid random por intento de
 * compra, ver StoreScreen) -- un doble tap en el mismo intento reusa la
 * MISMA key y no descuenta dos veces (ver apply_coin_transaction). */
export async function purchaseStoreItem(itemKey: string, idempotencyKey: string): Promise<PurchaseResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('purchase_store_item', { p_item_key: itemKey, p_idempotency_key: idempotencyKey });
  if (error) {
    console.error(JSON.stringify({ src: 'purchaseStoreItem', event: 'rpc_error', itemKey, message: error.message }));
    return { ok: false, errorCode: 'rpc_error' };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), errorCode: row.error_code ?? undefined, newBalance: row.new_balance != null ? Number(row.new_balance) : undefined };
}

export interface InventoryItem {
  inventoryItemId: string;
  itemKey: string;
  name: string;
  assetRef: string | null;
  equipSlot: EquipSlot | null;
  category: StoreItem['category'];
  acquiredAt: string;
  consumedAt: string | null;
}

interface InventoryStoreItemRow {
  item_key: string;
  name: string;
  asset_ref: string | null;
  equip_slot: EquipSlot | null;
  category: StoreItem['category'];
}

export async function fetchInventory(): Promise<InventoryItem[]> {
  if (!supabase) return [];
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, acquired_at, consumed_at, store_items(item_key, name, asset_ref, equip_slot, category)')
    .eq('user_id', session.user.id)
    .order('acquired_at', { ascending: false });
  if (error || !data) return [];
  return data
    .filter((r) => r.store_items)
    .map((r) => {
      const raw = r.store_items as unknown as InventoryStoreItemRow | InventoryStoreItemRow[];
      const item = Array.isArray(raw) ? raw[0] : raw;
      return {
        inventoryItemId: r.id,
        itemKey: item.item_key,
        name: item.name,
        assetRef: item.asset_ref,
        equipSlot: item.equip_slot,
        category: item.category,
        acquiredAt: r.acquired_at,
        consumedAt: r.consumed_at,
      };
    });
}

export async function equipItem(inventoryItemId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('equip_item', { p_inventory_item_id: inventoryItemId });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}

export async function unequipItem(slot: EquipSlot): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('unequip_item', { p_slot: slot });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}

/** Lo que YO tengo equipado, por slot -- para saber qué botón mostrar
 * (Equipar/Quitar) en Inventario. Usa la tabla propia (no la vista
 * pública): acá sí importa saber el inventory_item_id exacto. */
export async function fetchMyEquippedBySlot(): Promise<Record<EquipSlot, string | null>> {
  const empty: Record<EquipSlot, string | null> = { profile_frame: null, result_effect: null, badge: null, vs_effect: null };
  if (!supabase) return empty;
  const session = await getSession();
  if (!session) return empty;
  const { data, error } = await supabase.from('equipped_items').select('slot, inventory_item_id').eq('user_id', session.user.id);
  if (error || !data) return empty;
  const result = { ...empty };
  for (const row of data) result[row.slot as EquipSlot] = row.inventory_item_id;
  return result;
}

export interface PublicEquippedItem {
  slot: EquipSlot;
  itemKey: string;
  assetRef: string | null;
  name: string;
}

/** Lo que YO tengo equipado, para renderizarlo en mi propio Profile --
 * uso directo de la vista con mi propio id (session.user.id), sin pasar
 * por un username (más liviano, y ya lo tengo sin pedir nada extra). */
export async function fetchMyEquipped(): Promise<PublicEquippedItem[]> {
  if (!supabase) return [];
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('public_equipped_items')
    .select('slot, item_key, asset_ref, name')
    .eq('user_id', session.user.id);
  if (error || !data) return [];
  return data.map((r) => ({ slot: r.slot, itemKey: r.item_key, assetRef: r.asset_ref, name: r.name }));
}

/** Lo que OTRO usuario tiene equipado -- por username (H): nunca hay un
 * id crudo disponible del lado del cliente para un perfil ajeno, ver
 * get_public_equipped. Usado por PublicProfileScreen. */
export async function fetchPublicEquipped(username: string): Promise<PublicEquippedItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_public_equipped', { p_username: username });
  if (error || !data) return [];
  return data.map((r: { slot: EquipSlot; item_key: string; asset_ref: string | null; name: string }) => ({
    slot: r.slot,
    itemKey: r.item_key,
    assetRef: r.asset_ref,
    name: r.name,
  }));
}
