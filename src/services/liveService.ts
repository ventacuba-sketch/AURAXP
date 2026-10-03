import * as Crypto from 'expo-crypto';

import { getSession } from './authService';
import { supabase } from './supabaseClient';

/**
 * AURA LIVE -- metadata/RPCs de Supabase (ver
 * supabase/migrations/20261004000000_aura_live_mvp.sql). El video/audio
 * en sí vive en LiveKit (ver liveMediaService.web.ts) -- este archivo
 * solo habla con Postgres: crear/iniciar/terminar la sala, comentarios,
 * Aura Checks, votaciones. Mismo criterio que chatService.ts/
 * chatPrivateService.ts: capa fina sobre RPCs, toda la validación/
 * seguridad real vive server-side.
 */

export type LiveRoomStatus = 'preparing' | 'live' | 'ended' | 'cancelled';

export interface LiveRoom {
  id: string;
  slug: string;
  hostUserId: string;
  title: string;
  description: string | null;
  status: LiveRoomStatus;
  livekitRoomName: string;
  commentsEnabled: boolean;
  reactionsEnabled: boolean;
  auraChecksEnabled: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  peakViewers: number;
}

interface LiveRoomRow {
  id: string;
  slug: string;
  host_user_id: string;
  title: string;
  description: string | null;
  status: LiveRoomStatus;
  livekit_room_name: string;
  comments_enabled: boolean;
  reactions_enabled: boolean;
  aura_checks_enabled: boolean;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  peak_viewers: number;
}

function mapRoom(r: LiveRoomRow): LiveRoom {
  return {
    id: r.id,
    slug: r.slug,
    hostUserId: r.host_user_id,
    title: r.title,
    description: r.description,
    status: r.status,
    livekitRoomName: r.livekit_room_name,
    commentsEnabled: r.comments_enabled,
    reactionsEnabled: r.reactions_enabled,
    auraChecksEnabled: r.aura_checks_enabled,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    peakViewers: r.peak_viewers,
  };
}

/** `can_host_live` real -- nunca decidido en el cliente (ver la
 * migración: sin GRANT de UPDATE sobre esa columna para nadie, se activa
 * manualmente server-side). Esto solo LEE el flag para decidir qué UI
 * mostrar; la autorización real la vuelve a verificar create_live_room(). */
export async function canCurrentUserHostLive(): Promise<boolean> {
  if (!supabase) return false;
  const session = await getSession();
  if (!session) return false;
  const { data, error } = await supabase.from('profiles').select('can_host_live').eq('id', session.user.id).maybeSingle();
  if (error || !data) return false;
  return Boolean(data.can_host_live);
}

export interface CreateLiveRoomResult {
  ok: boolean;
  roomId?: string;
  slug?: string;
  errorCode?: string;
}

export async function createLiveRoom(title: string, description?: string): Promise<CreateLiveRoomResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('create_live_room', { p_title: title, p_description: description ?? null });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  return { ok: Boolean(row.ok), roomId: row.room_id ?? undefined, slug: row.slug ?? undefined, errorCode: row.error_code ?? undefined };
}

export async function startLiveRoom(roomId: string): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('start_live_room', { p_room_id: roomId });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), errorCode: row?.error_code ?? undefined };
}

export async function endLiveRoom(roomId: string): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('end_live_room', { p_room_id: roomId });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), errorCode: row?.error_code ?? undefined };
}

export async function reportLivePeakViewers(roomId: string, count: number): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('report_live_peak_viewers', { p_room_id: roomId, p_count: count });
  } catch {
    // Best-effort -- nunca debe interrumpir la transmisión del host.
  }
}

export async function fetchLiveRoomBySlug(slug: string): Promise<LiveRoom | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('live_rooms').select('*').eq('slug', slug).maybeSingle();
  if (error || !data) return null;
  return mapRoom(data as LiveRoomRow);
}

export async function fetchLiveRoomById(roomId: string): Promise<LiveRoom | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('live_rooms').select('*').eq('id', roomId).maybeSingle();
  if (error || !data) return null;
  return mapRoom(data as LiveRoomRow);
}

/** "EN VIVO AHORA" del lobby de Chat V2 (sección 15) -- nunca datos
 * falsos: si no hay filas, el caller simplemente no muestra la sección. */
export async function fetchLiveRoomsNow(limit = 5): Promise<LiveRoom[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('live_rooms')
    .select('*')
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as LiveRoomRow[]).map(mapRoom);
}

export interface LiveHostProfile {
  username: string;
  avatarEmoji: string;
}

export async function fetchLiveHostProfiles(hostUserIds: string[]): Promise<Record<string, LiveHostProfile>> {
  const result: Record<string, LiveHostProfile> = {};
  const ids = [...new Set(hostUserIds)];
  if (!supabase || !ids.length) return result;
  const { data, error } = await supabase.from('public_profiles').select('id, username, avatar_emoji').in('id', ids);
  if (error || !data) return result;
  for (const r of data) result[r.id] = { username: r.username, avatarEmoji: r.avatar_emoji };
  return result;
}

export interface LiveComment {
  id: string;
  liveRoomId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export const LIVE_COMMENT_MAX_LENGTH = 300;
export const LIVE_COMMENT_PAGE_SIZE = 40;

export async function fetchRecentLiveComments(roomId: string, before?: string): Promise<LiveComment[]> {
  if (!supabase) return [];
  let query = supabase
    .from('live_comments')
    .select('id, live_room_id, user_id, body, created_at')
    .eq('live_room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(LIVE_COMMENT_PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, liveRoomId: r.live_room_id, userId: r.user_id, body: r.body, createdAt: r.created_at }));
}

export async function sendLiveComment(roomId: string, body: string): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('send_live_comment', { p_room_id: roomId, p_body: body });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.error_code) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };
  return { ok: true };
}

export async function hideLiveComment(commentId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('hide_live_comment', { p_comment_id: commentId });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}

export interface LiveAuraCheck {
  id: string;
  liveRoomId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  result: { confidence: number; style: number; timing: number; cringeRisk: number; auraScore: number; verdictTag: string; headline: string } | null;
  createdAt: string;
  completedAt: string | null;
}

export async function fetchLiveAuraCheck(checkId: string): Promise<LiveAuraCheck | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('live_aura_checks_public').select('*').eq('id', checkId).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, liveRoomId: data.live_room_id, status: data.status, result: data.result, createdAt: data.created_at, completedAt: data.completed_at };
}

export interface RequestAuraCheckResult {
  ok: boolean;
  checkId?: string;
  errorCode?: string;
}

/** Sube el clip (signed upload URL, carpeta = user_id -- mismo patrón
 * exacto que scanService.uploadAndSubmitScan, bucket propio
 * `live-aura-checks`), crea la fila vía RPC, y dispara
 * process-live-aura-check (fire-and-forget, igual que process-scan). */
export async function requestLiveAuraCheck(roomId: string, clipBlob: Blob): Promise<RequestAuraCheckResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const session = await getSession();
  if (!session) return { ok: false, errorCode: 'not_authenticated' };

  const path = `${session.user.id}/${Crypto.randomUUID()}.webm`;
  const { data: signed, error: signErr } = await supabase.storage.from('live-aura-checks').createSignedUploadUrl(path);
  if (signErr || !signed) return { ok: false, errorCode: 'upload_prepare_failed' };

  const { error: uploadErr } = await supabase.storage
    .from('live-aura-checks')
    .uploadToSignedUrl(path, signed.token, clipBlob, { contentType: clipBlob.type || 'video/webm' });
  if (uploadErr) return { ok: false, errorCode: 'upload_failed' };

  const { data, error } = await supabase.rpc('request_live_aura_check', { p_room_id: roomId, p_storage_path: path });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ok) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };

  supabase.functions.invoke('process-live-aura-check', { body: { checkId: row.check_id } }).catch((e) => {
    console.warn('process-live-aura-check invoke failed', e);
  });

  return { ok: true, checkId: row.check_id };
}

export interface LivePoll {
  id: string;
  liveRoomId: string;
  optionALabel: string;
  optionBLabel: string;
  status: 'active' | 'closed';
  closesAt: string;
}

export async function fetchLivePoll(pollId: string): Promise<LivePoll | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('live_polls').select('*').eq('id', pollId).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    liveRoomId: data.live_room_id,
    optionALabel: data.option_a_label,
    optionBLabel: data.option_b_label,
    status: data.status,
    closesAt: data.closes_at,
  };
}

export async function createLivePoll(
  roomId: string,
  optionA: string,
  optionB: string,
  durationSeconds = 45,
): Promise<{ ok: boolean; pollId?: string; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('create_live_poll', {
    p_room_id: roomId,
    p_option_a: optionA,
    p_option_b: optionB,
    p_duration_seconds: durationSeconds,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ok) return { ok: false, errorCode: row?.error_code ?? 'rpc_error' };
  return { ok: true, pollId: row.poll_id };
}

export interface LivePollStatus {
  optionACount: number;
  optionBCount: number;
  myVote: 'a' | 'b' | null;
  isActive: boolean;
}

export async function voteLivePoll(pollId: string, option: 'a' | 'b'): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };
  const { data, error } = await supabase.rpc('vote_live_poll', { p_poll_id: pollId, p_option: option });
  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), errorCode: row?.error_code ?? undefined };
}

export async function getLivePollStatus(pollId: string): Promise<LivePollStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_live_poll_status', { p_poll_id: pollId });
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    optionACount: Number(row.option_a_count ?? 0),
    optionBCount: Number(row.option_b_count ?? 0),
    myVote: row.my_vote ?? null,
    isActive: Boolean(row.is_active),
  };
}

export async function closeLivePoll(pollId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('close_live_poll', { p_poll_id: pollId });
}

/** Link público compartible -- mismo criterio que challengeShareUrl
 * (challengeService.ts): un solo lugar que arma esta URL. */
const WEB_ORIGIN = 'https://auravs.app';
export function liveShareUrl(slug: string): string {
  return `${WEB_ORIGIN}/live/${slug}`;
}
