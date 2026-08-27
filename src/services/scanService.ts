import * as Crypto from 'expo-crypto';

import { ScanResult } from '../types';
import { computeVideoFingerprint } from '../utils/videoFingerprint';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

const BUCKET = 'scans';

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

  const fingerprint = await computeVideoFingerprint(videoUri, durationMs);
  const extension = videoUri.split('.').pop()?.split('?')[0] || 'mp4';
  const path = `${userId}/${Crypto.randomUUID()}.${extension}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error('No se pudo preparar la subida');

  const fileResponse = await fetch(videoUri);
  const blob = await fileResponse.blob();

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
