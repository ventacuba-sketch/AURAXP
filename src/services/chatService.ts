import { getSession } from './authService';
import { getVisitorId } from './campaignService';
import { supabase } from './supabaseClient';

/**
 * Chat V1 -- una sola sala global (ver supabase/migrations/20261002000000_chat_v1.sql
 * para el porqué de cada tabla/RPC). Todo lo económico/identitario real
 * pasa server-side; esto es una capa fina sobre las RPCs, igual criterio
 * que walletService/followService.
 */

export const CHAT_MESSAGE_MAX_LENGTH = 300;
export const CHAT_REACTION_EMOJIS = ['🔥', '⚡', '😂', '👑', '💀'] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number];

export const CHAT_STATUS_OPTIONS = [
  { key: 'farming_aura', label: '🔥 Farmeando Aura' },
  { key: 'looking_rival', label: '⚡ Buscando rival' },
  { key: 'chill', label: '😎 Chill' },
  { key: 'top_aura', label: '👑 Top Aura' },
] as const;
export type ChatStatusKey = (typeof CHAT_STATUS_OPTIONS)[number]['key'];

export interface ChatMessage {
  id: string;
  createdAt: string;
  body: string;
  userId: string | null;
  guestId: string | null;
}

export interface ChatSenderProfile {
  id: string;
  username: string;
  avatarEmoji: string;
  level: number;
  chatStatus: ChatStatusKey | null;
}

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

/** Identidad de invitado -- el MISMO visitor_id que ya usa la atribución
 * de campañas (ver campaignService.ts), nunca un segundo identificador ni
 * una fila nueva en auth.users por visitante. */
export async function getGuestId(): Promise<string> {
  return getVisitorId();
}

export const CHAT_PAGE_SIZE = 40;

/** Últimos mensajes visibles, más recientes primero tal cual vienen de la
 * base -- el caller los invierte para mostrarlos en orden cronológico.
 * `before` pagina hacia atrás en el tiempo (botón "cargar más"), nunca
 * carga historial completo de una. */
export async function fetchRecentMessages(before?: string): Promise<ChatMessage[]> {
  if (!supabase) return [];
  let query = supabase
    .from('chat_messages')
    .select('id, user_id, guest_id, body, created_at')
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    body: r.body,
    userId: r.user_id,
    guestId: r.guest_id,
  }));
}

/** Lookup en lote (nunca uno por mensaje) de los perfiles de los
 * remitentes registrados que aparecen en la tanda de mensajes actual. */
export async function fetchSenderProfiles(userIds: string[]): Promise<Record<string, ChatSenderProfile>> {
  const result: Record<string, ChatSenderProfile> = {};
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!supabase || !ids.length) return result;
  const { data, error } = await supabase
    .from('chat_public_profiles')
    .select('id, username, avatar_emoji, level, chat_status')
    .in('id', ids);
  if (error || !data) return result;
  for (const r of data) {
    result[r.id] = {
      id: r.id,
      username: r.username,
      avatarEmoji: r.avatar_emoji,
      level: r.level,
      chatStatus: r.chat_status,
    };
  }
  return result;
}

/** Igual criterio: lookup en lote de reacciones para la tanda de mensajes
 * actual, agregado client-side a {emoji, count, reactedByMe}. */
export async function fetchReactionSummaries(
  messageIds: string[],
  me: { userId?: string | null; guestId?: string | null },
): Promise<Record<string, ChatReactionSummary[]>> {
  const result: Record<string, ChatReactionSummary[]> = {};
  if (!supabase || !messageIds.length) return result;
  const { data, error } = await supabase
    .from('chat_reactions')
    .select('message_id, emoji, user_id, guest_id')
    .in('message_id', messageIds);
  if (error || !data) return result;

  const grouped = new Map<string, Map<string, ChatReactionSummary>>();
  for (const row of data) {
    const byEmoji = grouped.get(row.message_id) ?? new Map<string, ChatReactionSummary>();
    const existing = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
    existing.count += 1;
    const isMine = (me.userId && row.user_id === me.userId) || (me.guestId && row.guest_id === me.guestId);
    if (isMine) existing.reactedByMe = true;
    byEmoji.set(row.emoji, existing);
    grouped.set(row.message_id, byEmoji);
  }
  for (const [messageId, byEmoji] of grouped) {
    result[messageId] = [...byEmoji.values()];
  }
  return result;
}

export interface SendMessageResult {
  ok: boolean;
  errorCode?: string;
}

export async function sendChatMessage(body: string, guestId: string | null): Promise<SendMessageResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('send_chat_message', { p_body: body, p_guest_id: guestId });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.error_code) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };
  return { ok: true };
}

export async function toggleChatReaction(
  messageId: string,
  emoji: ChatReactionEmoji,
  guestId: string | null,
): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('toggle_chat_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
    p_guest_id: guestId,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.error_code) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };
  return { ok: true };
}

/** Status social predefinido -- autenticado solamente, validado server-side
 * contra el mismo enum fijo (ver set_chat_status en la migración). */
export async function setChatStatus(status: ChatStatusKey | null): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('set_chat_status', { p_status: status });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}

export interface GuestRewardState {
  amount: number;
  claimed: boolean;
}

/** Idempotente -- llamarla ante la primera señal real de intención del
 * invitado (su primer mensaje o primera reacción), nunca solo por abrir
 * la pantalla. Seguro de llamar repetidas veces: nunca cambia el monto ya
 * fijado ni crea una segunda recompensa para el mismo guestId. */
export async function ensureGuestReward(guestId: string): Promise<GuestRewardState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('ensure_chat_guest_reward', { p_guest_id: guestId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.error_code || row.amount == null) return null;
  return { amount: Number(row.amount), claimed: Boolean(row.claimed) };
}

/** Llamar UNA vez por sesión nueva (ver RootNavigator, mismo punto que
 * tryAttributePendingReferral) -- reclama la recompensa de bienvenida
 * pendiente para el visitor_id de este dispositivo, si la había y todavía
 * no se reclamó. Best-effort real: nunca debe poder bloquear el login. */
export async function claimGuestRewardIfAny(): Promise<void> {
  if (!supabase) return;
  try {
    const session = await getSession();
    if (!session) return;
    const guestId = await getGuestId();
    await supabase.rpc('claim_chat_guest_reward', { p_guest_id: guestId });
  } catch {
    // best-effort -- ver comentario de arriba.
  }
}

/**
 * Realtime acceleration -- puramente aditivo, mismo patrón que
 * scanService.subscribeToScan: si `chat_messages` no estuviera en la
 * publicación de supabase_realtime, este canal simplemente nunca dispara
 * y la pantalla sigue funcionando con los mensajes ya cargados (el
 * composer y el load-more no dependen de esto).
 */
export function subscribeToNewMessages(onInsert: (message: ChatMessage) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('chat-messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        const r = payload.new as { id: string; user_id: string | null; guest_id: string | null; body: string; created_at: string; hidden_at: string | null };
        if (r.hidden_at) return;
        onInsert({ id: r.id, createdAt: r.created_at, body: r.body, userId: r.user_id, guestId: r.guest_id });
      },
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

export function subscribeToReactionChanges(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('chat-reactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, () => onChange())
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}
