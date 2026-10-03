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
  senderId: string;
}

/** Un solo canal Broadcast por sala -- cada reacción es un mensaje
 * efímero, nunca una fila. `self: false` evita que el propio emisor se
 * vuelva a recibir su reacción (la pantalla ya la anima localmente al
 * tocar el botón, ver LiveRoomScreen). */
export function subscribeToLiveReactions(roomId: string, onReaction: (payload: ReactionPayload) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`live-reactions-${roomId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => onReaction(payload as ReactionPayload))
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

/** Throttle cliente básico (sección 38: "no permitir que un script mande
 * millones de mensajes") -- máx 1 reacción cada 300ms por remitente,
 * puramente para no saturar el propio canal de este dispositivo; el
 * límite real contra abuso server-side queda documentado como pendiente
 * (Broadcast no pasa por una RPC propia, ver el reporte final). */
const lastSentAt = new Map<string, number>();
const REACTION_THROTTLE_MS = 300;

export function sendLiveReaction(roomId: string, emoji: LiveReactionEmoji, senderId: string): void {
  if (!supabase) return;
  const now = Date.now();
  const last = lastSentAt.get(roomId) ?? 0;
  if (now - last < REACTION_THROTTLE_MS) return;
  lastSentAt.set(roomId, now);

  const channel = supabase.channel(`live-reactions-${roomId}`, { config: { broadcast: { self: false } } });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.send({ type: 'broadcast', event: 'reaction', payload: { emoji, senderId } });
      // Canal de un solo uso para enviar -- se cierra apenas despacha
      // (la pantalla mantiene su propia suscripción activa de LECTURA vía
      // subscribeToLiveReactions, separada de esta de escritura puntual).
      setTimeout(() => supabase?.removeChannel(channel), 500);
    }
  });
}
