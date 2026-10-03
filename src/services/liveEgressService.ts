/**
 * AURA LIVE -- abstracción FUTURA de multistream/RTMP (secciones 21/49
 * del pedido), deliberadamente NO funcional todavía.
 *
 * LiveKit Egress permite reenviar una sala como salida RTMP (TikTok
 * LIVE, Instagram LIVE, YouTube, etc.) o grabarla. Esto es real y
 * técnicamente viable más adelante, pero NO para este MVP -- activar
 * Egress implica transcodificación server-side con costo real por
 * minuto, y este archivo existe solo para que un futuro PR tenga dónde
 * enchufar esa lógica sin tener que rediseñar nada de AURA LIVE V1.
 *
 * Por diseño, HOY:
 * - `AURA_LIVE_EGRESS_ENABLED` es `false` y no hay forma de cambiarlo
 *   desde la UI (ningún botón llama a estas funciones).
 * - No existe Edge Function de Egress, no hay credenciales de
 *   TikTok/Instagram/YouTube en ningún lado, no hay RTMP secrets en la
 *   base de datos.
 * - Ninguna de las dos funciones de abajo hace una llamada de red real
 *   -- ambas devuelven `not_implemented` inmediatamente. Que algún día
 *   lo hagan requiere: (1) una Edge Function `livekit-egress` que llame
 *   a la Egress API de LiveKit con las credenciales RTMP del destino
 *   (nunca en el cliente), (2) subir `AURA_LIVE_EGRESS_ENABLED` junto
 *   con un flag explícito por sala (no un switch global), y (3)
 *   aprobación explícita de costos -- ver docs/aura-live.md.
 */

export const AURA_LIVE_EGRESS_ENABLED = false;

export interface ExternalStreamDestination {
  platform: 'tiktok' | 'instagram' | 'youtube' | 'rtmp_custom';
  /** URL RTMP completa -- en una implementación real, esto NUNCA se
   * acepta tal cual del cliente: se resuelve server-side a partir de
   * credenciales guardadas, nunca pegado a mano en la UI. */
  rtmpUrl?: string;
}

export interface StartExternalStreamResult {
  ok: boolean;
  errorCode: 'not_implemented';
}

/** Placeholder -- ver el comentario del archivo. Nunca llama a LiveKit
 * Egress, nunca factura nada, nunca requiere credenciales reales hoy. */
export async function startExternalStream(_roomId: string, _destination: ExternalStreamDestination): Promise<StartExternalStreamResult> {
  return { ok: false, errorCode: 'not_implemented' };
}

export async function stopExternalStream(_roomId: string): Promise<{ ok: boolean }> {
  return { ok: false };
}
