import { LiveAuraCheck, LiveComment } from './liveService';
import { supabase } from './supabaseClient';

/**
 * AURA LIVE -- tiempo real de comentarios (persistentes, Postgres
 * Changes) y reacciones (efímeras, Supabase Broadcast -- sección 12 del
 * pedido: "NO persistir cada reacción como una fila individual si eso va
 * a generar una tormenta de writes"). El viewer count REAL vive en
 * liveMediaService.web.ts (participantes de LiveKit, ver sección 36) --
 * nada acá inventa ni agrega un segundo conteo.
 *
 * Mismo límite honesto que Chat V1/V2: Realtime es best-effort, nunca
 * verificado contra un proyecto Supabase real desde este entorno.
 */

export function subscribeToLiveComments(
  roomId: string,
  onInsert: (comment: LiveComment) => void,
  onHidden: (commentId: string) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live-comments-${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'live_comments', filter: `live_room_id=eq.${roomId}` },
      (payload) => {
        const r = payload.new as { id: string; live_room_id: string; user_id: string; body: string; created_at: string; hidden_at: string | null };
        if (r.hidden_at) return;
        onInsert({ id: r.id, liveRoomId: r.live_room_id, userId: r.user_id, body: r.body, createdAt: r.created_at });
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_comments', filter: `live_room_id=eq.${roomId}` },
      (payload) => {
        const r = payload.new as { id: string; hidden_at: string | null };
        if (r.hidden_at) onHidden(r.id);
      },
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

/** Overlay temporal de Aura Check para TODOS los espectadores (sección
 * 18) -- suscripción sobre la tabla base (Postgres Changes no admite
 * vistas), ver el comentario en la migración sobre por qué
 * live_aura_checks es de lectura abierta. */
export function subscribeToLiveAuraCheckUpdates(roomId: string, onUpdate: (check: LiveAuraCheck) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live-aura-checks-${roomId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_aura_checks', filter: `live_room_id=eq.${roomId}` },
      (payload) => {
        const r = payload.new as {
          id: string;
          live_room_id: string;
          status: 'pending' | 'processing' | 'done' | 'failed';
          result: LiveAuraCheck['result'];
          created_at: string;
          completed_at: string | null;
        };
        onUpdate({ id: r.id, liveRoomId: r.live_room_id, status: r.status, result: r.result, createdAt: r.created_at, completedAt: r.completed_at });
      },
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

/** Detecta un poll NUEVO para la sala -- los conteos de voto se
 * refrescan con un polling liviano cada pocos segundos mientras está
 * activo (ver LiveRoomScreen), no con Realtime: live_poll_votes es
 * deliberadamente de lectura cerrada (ver la migración), así que no hay
 * nada que suscribir ahí sin exponer boletas individuales. */
export function subscribeToNewLivePolls(roomId: string, onNewPoll: (pollId: string) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live-polls-${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'live_polls', filter: `live_room_id=eq.${roomId}` },
      (payload) => onNewPoll((payload.new as { id: string }).id),
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

export const LIVE_REACTION_EMOJIS = ['🔥', '⚡', '❤️'] as const;
export type LiveReactionEmoji = (typeof LIVE_REACTION_EMOJIS)[number];

interface ReactionPayload {
  emoji: LiveReactionEmoji;
}

/** Un solo canal Broadcast por sala -- cada reacción es un mensaje
 * efímero, nunca una fila. `self: false` evita que el propio emisor se
 * vuelva a recibir su reacción (la pantalla ya la anima localmente al
 * tocar el botón, ver LiveRoomScreen). `private: true` (auditoría GPT
 * hallazgo #5) es lo que hace que ESTE canal pase por Realtime
 * Authorization -- la policy de SELECT sobre `realtime.messages` que
 * agrega la migración, acotada a este patrón de topic -- en vez del
 * relay clásico sin autorización; el payload ya NO trae `senderId`
 * (send_live_reaction() nunca lo manda, ver la migración: la UI nunca
 * necesitó saber quién reaccionó, solo animar el emoji). */
export function subscribeToLiveReactions(roomId: string, onReaction: (payload: ReactionPayload) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live-reactions-${roomId}`, { config: { broadcast: { self: false }, private: true } })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => onReaction(payload as ReactionPayload))
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

/** Debounce de UX puramente local (evita mandar la misma reacción varias
 * veces si alguien toca el botón como loco) -- esto NO es protección
 * contra abuso, solo evita llamadas redundantes a la RPC. La protección
 * REAL contra abuso vive 100% server-side en send_live_reaction()
 * (auditoría GPT hallazgo #5: el throttle anterior vivía SOLO acá y se
 * presentaba como si fuera seguridad, cuando cualquier script podía
 * saltarse el cliente y mandar un Broadcast directo). */
const lastSentAt = new Map<string, number>();
const REACTION_UX_DEBOUNCE_MS = 150;

export interface SendLiveReactionResult {
  ok: boolean;
  errorCode?: string;
}

/** ÚNICO camino que usa el cliente de AURA VS para mandar una reacción --
 * nunca un `channel.send()` directo (eso es lo que de verdad permitía a
 * cualquiera saltarse el throttle). `send_live_reaction()` resuelve la
 * identidad server-side (auth.uid() o p_guestId validado), aplica un
 * rate limit real vía upsert, y es quien de verdad emite el Broadcast
 * (`realtime.send()` desde la base) -- ver la migración para la
 * limitación honesta documentada sobre qué SÍ y qué NO queda cerrado. */
export async function sendLiveReaction(roomId: string, emoji: LiveReactionEmoji, guestId?: string | null): Promise<SendLiveReactionResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const now = Date.now();
  const last = lastSentAt.get(roomId) ?? 0;
  if (now - last < REACTION_UX_DEBOUNCE_MS) return { ok: false, errorCode: 'debounced' };
  lastSentAt.set(roomId, now);

  const { data, error } = await supabase.rpc('send_live_reaction', { p_room_id: roomId, p_emoji: emoji, p_guest_id: guestId ?? null });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), errorCode: row?.error_code ?? undefined };
}
