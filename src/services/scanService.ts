import * as Crypto from 'expo-crypto';

import { ScanResult } from '../types';
import { computeVideoFingerprint } from '../utils/videoFingerprint';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

const BUCKET = 'scans';

// Debe coincidir con el file_size_limit del bucket "scans" (ver
// supabase/migrations/20260828010000_scans_bucket_size_limit.sql) — 60 MB
// cubre con margen un clip de hasta 8s en los modos de grabación estándar
// de un teléfono moderno (4K/60 o slow-motion 1080p), sin permitir modos
// fuera de alcance para esta app (ProRes, 8K). Validar acá antes de subir
// evita gastar una signed URL y le da al usuario un mensaje claro en vez
// del error crudo de Storage.
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

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
  created_at: string;
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
  };
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
  const blob = await fileResponse.blob();

  if (blob.size > MAX_VIDEO_BYTES) {
    throw new VideoTooLargeError(blob.size, MAX_VIDEO_BYTES);
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
