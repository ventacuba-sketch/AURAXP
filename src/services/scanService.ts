import * as Crypto from 'expo-crypto';

import { ScanResult } from '../types';
import { MAX_UPLOAD_BYTES } from '../utils/uploadLimits';
import { computeVideoFingerprint } from '../utils/videoFingerprint';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

const BUCKET = 'scans';

export class VideoTooLargeError extends Error {
  sizeBytes: number;
  maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number) {
    super('VIDEO_TOO_LARGE');
    this.name = 'VideoTooLargeError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

// Suficiente para ver el Replay durante una sesión sin tener que
// re-mintear -- se pide una URL nueva cada vez que se abre ScanResult, así
// que esto no es una ventana de acceso permanente al video.
const VIDEO_SIGNED_URL_TTL_SECONDS = 60 * 60;

const MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
};

/**
 * El uri de origen no es confiable para sacar la extensión: en web
 * expo-image-picker entrega un blob:http://... sin extensión real, y
 * partir por "." ahí puede devolver basura. Preferimos el content-type del
 * blob y solo caemos al uri como último recurso.
 */
function guessExtension(videoUri: string, mimeType: string): string {
  if (MIME_EXTENSIONS[mimeType]) return MIME_EXTENSIONS[mimeType];

  const fromUri = videoUri.split('.').pop()?.split('?')[0];
  if (fromUri && /^[a-zA-Z0-9]{2,4}$/.test(fromUri)) return fromUri.toLowerCase();

  return 'mp4';
}

/**
 * Punto de entrada para la futura capa de compresión/downscale de video.
 *
 * TODO(producción): Gemini no necesita el video en su resolución original
 * (4K/HDR) para evaluar Aura -- bajarlo a 720p/1080p antes de subirlo
 * reduciría el tamaño típico muy por debajo de cualquier límite de plan de
 * Supabase, resolviendo el problema en la raíz en vez de solo detectarlo
 * con MAX_UPLOAD_BYTES. Requiere una librería de transcoding client-side
 * (o un paso server-side) que todavía no está en el MVP -- agregarla acá
 * atrasaría este fix, así que por ahora es un passthrough que no toca el
 * video. Cuando se implemente, este es el único lugar que necesita cambiar:
 * el resto de uploadAndSubmitScan ya trabaja sobre el Blob que devuelva.
 */
async function compressVideoIfNeeded(blob: Blob): Promise<Blob> {
  return blob;
}

/** Shape of a `scans` row as it comes back from Supabase (snake_case). */
interface ScanRow {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'rejected';
  verdict_tag: string | null;
  verdict_headline: string | null;
  aura_score: number | null;
  xp_awarded: number | null;
  beats: { time: string; delta: number; label: string }[] | null;
  stats: { confidence: number; style: number; timing: number; cringeRisk: number } | null;
  error_message: string | null;
  moderation_flagged: boolean;
  created_at: string;
  video_path: string | null;
  /** item_key del consumible que process-scan encontró ARMADO y consumió
   * para ESTE resultado (p. ej. 'confetti_boost') -- null si no había
   * ninguno activado. Lo decide el server, nunca el cliente (ver
   * activate_consumable/process-scan). */
  consumable_effect_key: string | null;
}

export function mapScanRowToScanResult(row: ScanRow): ScanResult {
  return {
    id: row.id,
    verdict: 'verified',
    verdictTag: row.verdict_tag ?? '',
    verdictHeadline: row.verdict_headline ?? '',
    auraScore: row.aura_score ?? 0,
    xpAwarded: row.xp_awarded ?? 0,
    timeline: row.beats ?? [],
    stats: row.stats ?? { confidence: 0, style: 0, timing: 0, cringeRisk: 0 },
    createdAt: row.created_at,
    videoPath: row.video_path ?? null,
    consumableEffectKey: row.consumable_effect_key ?? null,
  };
}

/**
 * Minta una signed URL temporal para reproducir el video de un scan --
 * el bucket "scans" es privado (ver policy scans_bucket_select_own), así
 * que no existe una URL pública fija: hay que pedir una nueva cada vez,
 * bajo el JWT del dueño del video.
 */
export async function getVideoPlaybackUrl(videoPath: string, scanId: string): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(videoPath, VIDEO_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Igual que getVideoPlaybackUrl, pero para un replay que puede NO ser
 * tuyo -- el del rival en un Challenge. Pasa por el Edge Function
 * get-replay-url en vez de pedir la signed URL directo desde el cliente:
 * bug real encontrado probando con dos cuentas (ver ese archivo) --
 * el replay propio funcionaba pero el del rival no, con la única
 * diferencia siendo una RLS policy de storage.objects con un JOIN de dos
 * saltos (storage.objects -> scans -> challenges) en vez de una
 * condición de una sola tabla. La autorización acá vive en código
 * explícito server-side, no en esa cadena de policies -- mismas dos
 * reglas (dueño del scan, o participante de un Challenge 'completed' que
 * lo incluye), pero en un solo lugar auditable.
 */
export async function getChallengeReplayUrl(scanId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.functions.invoke('get-replay-url', { body: { scanId } });
  if (error || !data?.url) return null;
  return data.url as string;
}

/**
 * Sube el video (signed upload URL, carpeta = user_id — ver la policy de
 * Storage), inserta la fila de `scans` y dispara `process-scan`. Devuelve
 * el scanId para que Analyzing haga polling sobre él.
 */
export async function uploadAndSubmitScan(
  videoUri: string,
  durationMs: number,
  challengeToken?: string,
): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const session = await getSession();
  if (!session) throw new Error('No autenticado');
  const userId = session.user.id;

  // Un solo fetch del video: antes se leía dos veces (una vía
  // expo-file-system para el fingerprint, otra vía fetch para la subida).
  // Funciona igual para file:// (nativo) y blob: (web).
  const fileResponse = await fetch(videoUri);
  const rawBlob = await fileResponse.blob();
  const blob = await compressVideoIfNeeded(rawBlob);

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new VideoTooLargeError(blob.size, MAX_UPLOAD_BYTES);
  }

  const fingerprint = await computeVideoFingerprint(blob, durationMs);
  const extension = guessExtension(videoUri, blob.type);
  const path = `${userId}/${Crypto.randomUUID()}.${extension}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error('No se pudo preparar la subida');

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, signed.token, blob, { contentType: blob.type || 'video/mp4' });
  if (uploadErr) throw uploadErr;

  const { data: scan, error: insertErr } = await supabase
    .from('scans')
    .insert({ user_id: userId, video_path: path, video_hash: fingerprint, duration_ms: durationMs })
    .select('id')
    .single();
  if (insertErr || !scan) throw insertErr ?? new Error('No se pudo crear el scan');

  // No esperamos a que termine — Analyzing hace polling sobre el status.
  supabase.functions
    .invoke('process-scan', { body: { scanId: scan.id, challengeToken } })
    .catch((e) => console.warn('process-scan invoke failed', e));

  return scan.id;
}

export async function getScan(scanId: string): Promise<ScanRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('scans').select('*').eq('id', scanId).single();
  if (error) return null;
  return data as ScanRow;
}

/**
 * Outcome of one status check, used by Analyzing's polling loop. Unlike
 * getScan() above (kept as-is -- useScanResult relies on its "null means
 * fall back to mock" contract), this never collapses a real error into
 * the same shape as "still processing": that conflation is exactly what
 * let a stuck scan look identical to a silently-failing one, with no way
 * to tell them apart from the UI.
 */
export type ScanStatusCheck =
  | { kind: 'pending' }
  | { kind: 'done'; scan: ScanRow }
  | { kind: 'failed'; scan: ScanRow }
  | { kind: 'rejected'; scan: ScanRow }
  | { kind: 'error'; message: string };

export async function checkScanStatus(scanId: string): Promise<ScanStatusCheck> {
  if (!supabase) return { kind: 'error', message: 'Supabase no está configurado' };

  const { data, error } = await supabase.from('scans').select('*').eq('id', scanId).single();
  if (error) return { kind: 'error', message: error.message };
  if (!data) return { kind: 'error', message: 'Scan no encontrado' };

  const scan = data as ScanRow;
  if (scan.status === 'done') return { kind: 'done', scan };
  if (scan.status === 'failed') return { kind: 'failed', scan };
  if (scan.status === 'rejected') return { kind: 'rejected', scan };
  return { kind: 'pending' };
}

/**
 * Realtime acceleration for Analyzing -- purely additive. If the `scans`
 * table isn't added to the supabase_realtime publication, this channel
 * just never fires and the caller's polling stays the sole (and
 * sufficient) source of truth; it never throws for that reason, so it's
 * always safe to call regardless of whether Realtime is enabled.
 */
export function subscribeToScan(scanId: string, onUpdate: (scan: ScanRow) => void): () => void {
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`scan-${scanId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'scans', filter: `id=eq.${scanId}` },
      (payload) => onUpdate(payload.new as ScanRow),
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

/** Shape returned by the get-daily-scan-status Edge Function. */
export interface DailyScanStatus {
  plan: 'free' | 'pro';
  count: number;
  /** null para PRO (fair-use interno, nunca se revela) y para una cuenta
   * de prueba ilimitada -- el caller decide qué mostrar usando `plan` /
   * `unlimited`, no un número en esos dos casos. Presente (5 o 3) para FREE. */
  cap: number | null;
  /** true si esta cuenta está en UNLIMITED_TEST_USER_IDS (ver process-scan) --
   * el límite diario no se le aplica, sea cual sea `plan`. Nunca se mezcla
   * con `count`/`cap`: el caller debe mostrar uno u otro, no ambos a la vez. */
  unlimited: boolean;
  /** true durante los primeros 15 días de la cuenta (solo aplica a FREE). */
  inLaunchWindow: boolean;
  /** Días de bienvenida restantes; 0 si no aplica. */
  launchDaysLeft: number;
  /** Kill switch de costo (ver migración system_status) -- 'normal' es el
   * único valor que existe hoy en producción, así que esto no cambia nada
   * todavía. 'high_demand'/'emergency' solo se usan si alguna vez se activan
   * a mano en el Dashboard. */
  systemMode: 'normal' | 'high_demand' | 'emergency';
  systemMessage: string | null;
}

/**
 * Cuántos Scans lleva hoy el usuario actual, contra el límite real (y qué
 * plan tiene) -- SIEMPRE desde el backend (daily_scan_counts + profiles.plan
 * vía el Edge Function get-daily-scan-status), nunca estimado acá.
 * `daily_scan_counts` tiene RLS sin policies para el cliente a propósito
 * (ver init_schema.sql), así que no hay forma de leerla directo con
 * `supabase.from(...)` -- este Edge Function es la única puerta, y usa la
 * misma resolveDailyCap() que process-scan para decidir el límite (ver
 * _shared/dailyLimit.ts) -- nunca lo recalcula distinto.
 */
export async function fetchDailyScanStatus(): Promise<DailyScanStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.functions.invoke('get-daily-scan-status');
  if (error || !data || data.error) return null;
  return data as DailyScanStatus;
}

/**
 * El último Scan `done` REAL del usuario autenticado -- fuente única para
 * "qué scan uso para desafiar a alguien" (Challenge directo, ver
 * PublicProfileScreen). Auditoría del bug "No pudimos crear el desafío":
 * ese flujo reusaba `api.fetchLatestReplay()`, pensada para la card
 * "ÚLTIMO REPLAY" de Home -- tiene un fallback a `mockLatestReplay`
 * (id `"s_001"`, no un uuid real) para cuando no hay sesión/Supabase, que
 * es exactamente el comportamiento correcto PARA ESA pantalla pero
 * incorrecto acá: un id mock nunca puede pasar el chequeo de
 * `create_direct_challenge` (`scans.id = p_source_scan_id AND user_id =
 * auth.uid() AND status = 'done'`), y el RPC devolvía un error de
 * casteo/validación que el catch-all mostraba como el mensaje genérico.
 * Esta función es de propósito único: `null` siempre que no haya un scan
 * real y válido, NUNCA un id de relleno.
 */
export async function fetchMyLatestValidScanId(): Promise<string | null> {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('scans')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}
