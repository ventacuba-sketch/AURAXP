import { logEvent } from './analyticsService';
import { supabase } from './supabaseClient';

/**
 * Chat V2 "Sala Social" -- mensajes privados CON CONSENTIMIENTO (ver
 * supabase/migrations/20261003000000_chat_v2_social_room.sql para el
 * porqué de cada tabla/RPC: nunca se puede escribir en privado a nadie
 * sin que la otra persona acepte explícitamente la solicitud primero).
 * Archivo separado de chatService.ts (Chat V1, sala global) a propósito
 * -- cero cambios en ese archivo, menor riesgo de regresión.
 */

export const PRIVATE_MESSAGE_MAX_LENGTH = 300;

export interface PrivateRequestResult {
  ok: boolean;
  requestId?: string;
  /** 'not_authenticated' | 'target_not_found' | 'cannot_request_self' |
   * 'blocked' | 'rate_limited' | 'pending_incoming_exists' (ya tenías una
   * solicitud pendiente DE esa persona -- respóndela en vez de mandar
   * otra) | 'already_requested' | 'cooldown' | 'rpc_error'. */
  errorCode?: string;
}

/** Punto 4 del pedido -- único camino para iniciar un chat privado. La
 * otra persona ve esto como una solicitud explícita (Aceptar/Rechazar),
 * nunca se abre una conversación directo. */
export async function requestPrivateChat(targetUsername: string): Promise<PrivateRequestResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('request_private_chat', { p_target_username: targetUsername });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), requestId: row.request_id ?? undefined, errorCode: row.error_code ?? undefined };
}

export interface PrivateRespondResult {
  ok: boolean;
  conversationId?: string;
  errorCode?: string;
}

/** Aceptar/rechazar una solicitud entrante. Solo si `accept` es true y la
 * respuesta es exitosa existe de verdad una conversación (conversationId). */
export async function respondToPrivateChatRequest(requestId: string, accept: boolean): Promise<PrivateRespondResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('respond_private_chat_request', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), conversationId: row.conversation_id ?? undefined, errorCode: row.error_code ?? undefined };
}

export interface IncomingPrivateRequest {
  id: string;
  requesterId: string;
  requesterUsername: string;
  requesterAvatarEmoji: string;
  createdAt: string;
}

/** Solicitudes entrantes pendientes (yo soy el recipient) -- se consulta
 * la tabla directo, protegida por su propia RLS
 * (chat_private_requests_select_involved), igual criterio que
 * fetchRecentMessages en Chat V1. */
export async function fetchIncomingPrivateRequests(myUserId: string): Promise<IncomingPrivateRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('chat_private_requests')
    .select('id, requester_id, created_at')
    .eq('recipient_id', myUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data || !data.length) return [];

  const requesterIds = [...new Set(data.map((r) => r.requester_id))];
  const { data: profiles } = await supabase
    .from('chat_public_profiles')
    .select('id, username, avatar_emoji')
    .in('id', requesterIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  return data.map((r) => {
    const p = byId.get(r.requester_id);
    return {
      id: r.id,
      requesterId: r.requester_id,
      requesterUsername: p?.username ?? '...',
      requesterAvatarEmoji: p?.avatar_emoji ?? '🙂',
      createdAt: r.created_at,
    };
  });
}

/** Realtime best-effort (igual límite honesto que Chat V1: si
 * `chat_private_requests` no estuviera en la publicación de
 * supabase_realtime, o si Realtime no entrega el INSERT a este cliente,
 * simplemente nunca dispara -- nunca se afirmó probado contra un proyecto
 * Supabase real desde este entorno). `onIncoming` recibe el id de la
 * solicitud nueva; el caller decide si refresca la lista completa. */
export function subscribeToIncomingPrivateRequests(myUserId: string, onIncoming: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`chat-private-requests-${myUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_private_requests', filter: `recipient_id=eq.${myUserId}` },
      () => onIncoming(),
    )
    .subscribe();
  return () => {
    supabase?.removeChannel(channel);
  };
}

export interface PrivateConversationSummary {
  conversationId: string;
  peerId: string;
  peerUsername: string;
  peerAvatarEmoji: string;
  lastMessageAt: string;
  lastMessageBody: string | null;
  unreadCount: number;
}

/** Bandeja de Privados, ordenada por última actividad (ya lo hace el RPC) --
 * ver list_private_conversations en la migración. */
export async function listPrivateConversations(): Promise<PrivateConversationSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_private_conversations');
  if (error || !data) return [];
  return data.map(
    (r: {
      conversation_id: string;
      peer_id: string;
      peer_username: string;
      peer_avatar_emoji: string;
      last_message_at: string;
      last_message_body: string | null;
      unread_count: number;
    }) => ({
      conversationId: r.conversation_id,
      peerId: r.peer_id,
      peerUsername: r.peer_username,
      peerAvatarEmoji: r.peer_avatar_emoji,
      lastMessageAt: r.last_message_at,
      lastMessageBody: r.last_message_body,
      unreadCount: Number(r.unread_count ?? 0),
    }),
  );
}

/** Total de no-leídos a través de TODAS las conversaciones -- para el
 * badge "💬 Privados ③" en la cabecera del chat global. Un solo round
 * trip extra (list_private_conversations ya resuelve el conteo por
 * conversación; esto solo suma). */
export async function fetchTotalUnreadPrivateCount(): Promise<number> {
  const list = await listPrivateConversations();
  return list.reduce((sum, c) => sum + c.unreadCount, 0);
}

export async function markPrivateConversationRead(conversationId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('mark_private_conversation_read', { p_conversation_id: conversationId });
}

export interface PrivateMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export const PRIVATE_MESSAGE_PAGE_SIZE = 40;

/** Igual criterio que fetchRecentMessages (Chat V1): más recientes
 * primero tal cual vienen de la base, el caller invierte para mostrar en
 * orden cronológico; `before` pagina hacia atrás. Protegido por RLS
 * (chat_private_messages_select_involved) -- un tercero ajeno a la
 * conversación nunca recibe filas, ni siquiera sabiendo el conversationId. */
export async function fetchPrivateMessages(
  conversationId: string,
  before?: string,
): Promise<{ messages: PrivateMessage[]; error: boolean }> {
  if (!supabase) return { messages: [], error: false };
  let query = supabase
    .from('chat_private_messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PRIVATE_MESSAGE_PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) return { messages: [], error: true };
  if (!data) return { messages: [], error: false };
  return {
    messages: data.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      body: r.body,
      createdAt: r.created_at,
    })),
    error: false,
  };
}

export interface SendPrivateMessageResult {
  ok: boolean;
  errorCode?: string;
}

export async function sendPrivateMessage(conversationId: string, body: string): Promise<SendPrivateMessageResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('send_private_message', {
    p_conversation_id: conversationId,
    p_body: body,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.error_code) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };
  return { ok: true };
}

/** Realtime best-effort para una conversación abierta -- mismo límite
 * honesto que subscribeToNewMessages en V1. Si no llega, el fallback es
 * el refresh explícito que ya hace la pantalla después de enviar (ver
 * ChatPrivateConversationScreen), nunca deja la UX dependiendo
 * exclusivamente de este canal. */
export function subscribeToPrivateMessages(conversationId: string, onInsert: (message: PrivateMessage) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`chat-private-messages-${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_private_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const r = payload.new as { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
        onInsert({ id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, body: r.body, createdAt: r.created_at });
      },
    )
    .subscribe();
  return () => {
    supabase?.removeChannel(channel);
  };
}

export interface BlockUserResult {
  ok: boolean;
  errorCode?: string;
}

/** Punto 8 del pedido -- bloquea a `targetUsername`: no puede volver a
 * pedir/enviar privados, y la conversación (si existía) desaparece de MI
 * bandeja sin tocar un solo mensaje histórico (ver block_user en la
 * migración). No hay unblock_user todavía -- ver el reporte final de esta
 * tarea para por qué queda fuera de este alcance. */
export async function blockUser(targetUsername: string): Promise<BlockUserResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('block_user', { p_target_username: targetUsername });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), errorCode: row.error_code ?? undefined };
}

export interface ChatMember {
  id: string;
  username: string;
  avatarEmoji: string;
  level: number;
  chatStatus: string | null;
  /** Último Scan 'done' real -- nunca recalculado (ver chat_member_profiles
   * en la migración). null si todavía no tiene ningún Scan válido. */
  lastAuraScore: number | null;
}

/** Perfiles de integrante para el panel de Integrantes -- en lote, para
 * el set de ids que Presence (o el fallback de actividad reciente,
 * ver chatPresenceService.ts) ya resolvió client-side. Nunca inventa
 * quién está activo: esto solo completa username/level/status/Aura para
 * ids que YA se sabe que están presentes/activos. */
export async function fetchChatMembers(userIds: string[]): Promise<ChatMember[]> {
  if (!supabase || !userIds.length) return [];
  const ids = [...new Set(userIds)];
  const { data, error } = await supabase
    .from('chat_member_profiles')
    .select('id, username, avatar_emoji, level, chat_status, last_aura_score')
    .in('id', ids);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    username: r.username,
    avatarEmoji: r.avatar_emoji,
    level: r.level,
    chatStatus: r.chat_status,
    lastAuraScore: r.last_aura_score,
  }));
}

/** Atajo usado por las pantallas: loguea el tap y arma el label fijo de
 * estado social (mismo set de 4 valores que Chat V1 -- ver
 * CHAT_STATUS_OPTIONS en chatService.ts, no se duplica acá). */
export function logChatPrivateEvent(name: 'chat_members_opened' | 'chat_member_profile_opened' | 'chat_private_inbox_opened' | 'chat_private_conversation_opened', metadata?: Record<string, unknown>): void {
  void logEvent(name, metadata);
}
