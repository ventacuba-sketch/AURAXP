import { supabase } from './supabaseClient';

/** Regalos con Coins (bloque social) -- solo los items category='gift' de
 * la tienda pueden mandarse acá, ver send_gift en la migración. Nunca
 * convierte Coins en Aura/XP/votos. */
export interface SendGiftResult {
  ok: boolean;
  errorCode?: string;
  newBalance?: number;
}

export async function sendGift(recipientUsername: string, giftKey: string, idempotencyKey: string): Promise<SendGiftResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('send_gift', {
    p_recipient_username: recipientUsername,
    p_gift_key: giftKey,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    console.error(JSON.stringify({ src: 'sendGift', event: 'rpc_error', recipientUsername, giftKey, message: error.message }));
    return { ok: false, errorCode: 'rpc_error' };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), errorCode: row.error_code ?? undefined, newBalance: row.new_balance != null ? Number(row.new_balance) : undefined };
}
