import { supabase } from './supabaseClient';

/**
 * Presencia real del Chat V2 (punto 9 del pedido) -- Supabase Realtime
 * Presence, UN SOLO canal compartido por toda la sala global, sin tabla
 * ni columna nueva: Presence vive enteramente en el servidor de Realtime
 * (no en Postgres), así que esto es 100% client-side sobre la MISMA
 * librería (@supabase/supabase-js) que ya usan subscribeToNewMessages/
 * subscribeToReactionChanges en Chat V1 -- arquitectura ya presente en el
 * proyecto, cero dependencia nueva.
 *
 * Honestidad explícita del pedido ("nunca mostrar un número falso"): este
 * conteo es SIEMPRE el estado real sincronizado por Realtime (cada
 * pestaña/dispositivo conectado hace `track()` una vez y aparece acá) --
 * nunca una estimación ni un número decorativo. El límite real, igual que
 * el resto del chat: si Realtime no está habilitado/alcanzable desde este
 * entorno, `subscribed` queda en false y el caller (ver ChatScreen) debe
 * caer al fallback honesto de "activos recientemente" en vez de mostrar
 * "0 conectados" como si fuera un hecho confirmado.
 */

const GLOBAL_PRESENCE_CHANNEL = 'chat-global-presence';

export interface ChatPresenceState {
  /** true solo cuando el canal de Presence llegó a SUBSCRIBED de verdad --
   * si nunca llega (Realtime deshabilitado/inalcanzable), queda false y
   * `onlineCount`/`onlineUserIds` no deben tomarse como un hecho confirmado. */
  subscribed: boolean;
  /** Presencias activas ahora mismo -- puede ser más de una por persona
   * (varias pestañas/dispositivos), eso es correcto: cada una es una
   * conexión real. Incluye invitados (sin perfil, no distinguibles acá). */
  onlineCount: number;
  /** user_id de cada AUTENTICADO presente ahora mismo -- nunca incluye
   * invitados (no tienen fila de perfil que mostrar en Integrantes). */
  onlineUserIds: Set<string>;
}

type PresenceEntry = { user_id: string | null; guest_id: string | null };
type Listener = (state: ChatPresenceState) => void;

/**
 * Une a este viewer (autenticado o invitado) a la presencia de la sala
 * global y notifica cada cambio real de estado. Llamar UNA vez por
 * montaje de ChatScreen -- la función de limpieza devuelta quita este
 * presence y cierra el canal.
 */
export function joinChatPresence(identity: { userId: string | null; guestId: string | null }, onChange: Listener): () => void {
  if (!supabase) {
    onChange({ subscribed: false, onlineCount: 0, onlineUserIds: new Set() });
    return () => {};
  }

  const presenceKey = identity.userId ?? identity.guestId ?? Math.random().toString(36).slice(2);
  const channel = supabase.channel(GLOBAL_PRESENCE_CHANNEL, {
    config: { presence: { key: presenceKey } },
  });

  function emit(subscribed: boolean) {
    const state = channel.presenceState<PresenceEntry>();
    const entries = Object.values(state).flat();
    const onlineUserIds = new Set<string>();
    for (const entry of entries) {
      if (entry.user_id) onlineUserIds.add(entry.user_id);
    }
    onChange({ subscribed, onlineCount: entries.length, onlineUserIds });
  }

  channel.on('presence', { event: 'sync' }, () => emit(true));

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.track({ user_id: identity.userId, guest_id: identity.guestId, online_at: new Date().toISOString() });
      emit(true);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      onChange({ subscribed: false, onlineCount: 0, onlineUserIds: new Set() });
    }
  });

  return () => {
    supabase?.removeChannel(channel);
  };
}

/**
 * Estado de UNA persona puntual (header de una conversación privada,
 * "● En línea / ○ Activo recientemente") -- se apoya en el MISMO canal
 * global de arriba (no abre un canal nuevo por conversación): si
 * `peerUserId` está en `onlineUserIds`, está en línea de verdad ahora
 * mismo. `lastKnownActivityAt` (último mensaje real de esa persona, en
 * cualquier conversación/sala -- lo resuelve el caller) es el fallback
 * honesto cuando Presence no lo confirma en línea -- nunca inventa
 * "en línea" sin que Presence lo diga.
 */
export function derivePeerStatusLabel(
  peerUserId: string,
  presence: ChatPresenceState,
  lastKnownActivityAt: string | null,
): string {
  if (presence.subscribed && presence.onlineUserIds.has(peerUserId)) return '● En línea';
  if (!lastKnownActivityAt) return '○ Sin actividad reciente';
  const minutesAgo = Math.floor((Date.now() - new Date(lastKnownActivityAt).getTime()) / 60000);
  if (minutesAgo < 15) return '○ Activo recientemente';
  if (minutesAgo < 24 * 60) return `○ Activo hace ${Math.floor(minutesAgo / 60) || 1}h`;
  return '○ Sin actividad reciente';
}
