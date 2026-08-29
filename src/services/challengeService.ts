import * as Crypto from 'expo-crypto';

import { Challenge, ChallengeParticipant, ChallengePreview } from '../types';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

/** Corto y URL-friendly — no hace falta un UUID completo para un share_token. */
function generateShareToken(): string {
  return Crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export async function createChallenge(sourceScanId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const session = await getSession();
  if (!session) throw new Error('No autenticado');

  const shareToken = generateShareToken();
  const { error } = await supabase
    .from('challenges')
    .insert({ share_token: shareToken, source_scan_id: sourceScanId, from_user_id: session.user.id });
  if (error) throw error;

  return shareToken;
}

/** Pública — no requiere sesión. Usada por la landing (deep link/URL web)
 * antes de que el visitante tenga o no cuenta. */
export async function fetchChallengePreview(token: string): Promise<ChallengePreview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.functions.invoke('get-challenge-preview', {
    body: { token },
  });
  if (error || !data || data.error) return null;
  return data as ChallengePreview;
}

export interface AcceptChallengeResult {
  ok: boolean;
  /** 'not_authenticated' | 'not_found' | 'cannot_accept_own' | 'already_taken' | 'expired' | 'rpc_error' */
  errorCode?: string;
}

/**
 * Aceptación real -- corre server-side (función `accept_challenge`,
 * SECURITY DEFINER) con lock de fila, así que dos aceptaciones casi
 * simultáneas del mismo link no pueden "empatar": una gana, la otra
 * recibe 'already_taken'. El cliente nunca decide esto por su cuenta.
 */
export async function acceptChallenge(shareToken: string): Promise<AcceptChallengeResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };

  const { data, error } = await supabase.rpc('accept_challenge', { p_share_token: shareToken });
  if (error) return { ok: false, errorCode: 'rpc_error' };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), errorCode: row.error_code ?? undefined };
}

/** Solo el creador, y solo mientras nadie aceptó todavía (ver cancel_challenge en la migración). */
export async function cancelChallenge(challengeId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('cancel_challenge', { p_challenge_id: challengeId });
  if (error) return false;
  return Boolean(data);
}

interface PublicProfileRow {
  id: string;
  username: string;
  avatar_emoji: string;
}

interface ScanSummaryRow {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'rejected';
  aura_score: number | null;
  stats: { confidence: number; style: number; timing: number; cringeRisk: number } | null;
  verdict_tag: string | null;
  video_path: string | null;
}

async function fetchPublicProfile(userId: string): Promise<PublicProfileRow | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('public_profiles').select('id, username, avatar_emoji').eq('id', userId).single();
  return data as PublicProfileRow | null;
}

async function fetchScanSummary(scanId: string): Promise<ScanSummaryRow | null> {
  if (!supabase) return null;
  // Puede devolver null tanto porque el scan no existe como porque RLS lo
  // filtra (el scan del rival, antes de que el challenge esté 'completed')
  // -- ambos casos se tratan igual: "todavía no hay nada que mostrar".
  const { data } = await supabase
    .from('scans')
    .select('id, status, aura_score, stats, verdict_tag, video_path')
    .eq('id', scanId)
    .maybeSingle();
  return data as ScanSummaryRow | null;
}

function buildParticipant(userId: string, profile: PublicProfileRow, scan: ScanSummaryRow | null): ChallengeParticipant {
  return {
    userId,
    username: profile.username,
    avatarEmoji: profile.avatar_emoji,
    auraScore: scan?.aura_score ?? null,
    stats: scan?.stats ?? null,
    verdictTag: scan?.verdict_tag ?? null,
    videoPath: scan?.video_path ?? null,
    scanId: scan?.id ?? null,
    scanStatus: scan?.status ?? null,
  };
}

/**
 * Vista completa y autenticada de un Challenge, para el creador esperando
 * rival, el oponente ya aceptado, o cualquiera de los dos viendo el
 * resultado. RLS decide qué se ve realmente: el scan del rival solo es
 * legible una vez `status === 'completed'` (ver migración) -- antes de eso
 * simplemente llega `null` en esos campos, sin error.
 */
export async function getChallenge(shareToken: string): Promise<Challenge | null> {
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from('challenges')
    .select(
      'id, share_token, status, from_user_id, opponent_user_id, source_scan_id, target_scan_id, winner_user_id, is_tie, creator_xp_awarded, opponent_xp_awarded, expires_at',
    )
    .eq('share_token', shareToken)
    .maybeSingle();

  if (error || !row) return null;

  const [creatorProfile, opponentProfile, creatorScan, opponentScan] = await Promise.all([
    fetchPublicProfile(row.from_user_id),
    row.opponent_user_id ? fetchPublicProfile(row.opponent_user_id) : Promise.resolve(null),
    fetchScanSummary(row.source_scan_id),
    row.target_scan_id ? fetchScanSummary(row.target_scan_id) : Promise.resolve(null),
  ]);

  if (!creatorProfile) return null;

  return {
    id: row.id,
    shareToken: row.share_token,
    status: row.status,
    creator: buildParticipant(row.from_user_id, creatorProfile, creatorScan),
    opponent: row.opponent_user_id && opponentProfile ? buildParticipant(row.opponent_user_id, opponentProfile, opponentScan) : null,
    winnerUserId: row.winner_user_id,
    isTie: row.is_tie,
    creatorXpAwarded: row.creator_xp_awarded,
    opponentXpAwarded: row.opponent_xp_awarded,
    expiresAt: row.expires_at,
  };
}
