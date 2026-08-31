import * as Crypto from 'expo-crypto';

import { Challenge, ChallengeListItem, ChallengeParticipant, ChallengePreview } from '../types';
import { ShareCardData } from '../utils/shareCard';
import { logEvent } from './analyticsService';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

/** Corto y URL-friendly — no hace falta un UUID completo para un share_token. */
function generateShareToken(): string {
  return Crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

// Único lugar que arma la URL pública de un Challenge -- antes vivía
// duplicado como constante local en ChallengeScreen.tsx; MyChallengesScreen
// necesita exactamente la misma URL para "COMPARTIR DE NUEVO" en la lista,
// así que se centraliza acá para que nunca puedan divergir.
const WEB_ORIGIN = 'https://auravs.app';
export function challengeShareUrl(token: string): string {
  return `${WEB_ORIGIN}/c/${token}`;
}

/**
 * Texto + datos de la result card para compartir un Challenge YA
 * COMPLETADO -- único lugar que arma esto, para que ChallengeScreen y
 * MyChallengesScreen nunca puedan divergir (ver auditoría: "compartir
 * resultado" antes era solo texto plano, ahora siempre viaja con la
 * imagen -- generateChallengeShareCardBlob en utils/shareCard.ts).
 *
 * Deliberadamente solo toma username/avatar/score -- nunca un user id, un
 * scanId ni un path de Storage, para que sea imposible que un caller le
 * pase por error algo que no debería ser público (ver sección L,
 * seguridad de la result card).
 */
export function buildChallengeResultShare(params: {
  meUsername: string;
  meAvatarEmoji: string;
  meScore: number;
  rivalUsername: string;
  rivalAvatarEmoji: string;
  rivalScore: number;
  isTie: boolean;
  iWon: boolean;
}): { text: string; card: ShareCardData } {
  const { meUsername, rivalUsername, meScore, rivalScore, isTie, iWon } = params;

  const text = isTie
    ? `Empaté con @${rivalUsername} en AURA VS 🤝 ${meScore >= 0 ? '+' : ''}${meScore} vs ${rivalScore >= 0 ? '+' : ''}${rivalScore}. ¿Tienes más Aura?`
    : iWon
      ? `Le gané a @${rivalUsername} en AURA VS 🏆 ¿Tienes más Aura que yo?`
      : `@${rivalUsername} me ganó en AURA VS ⚡ ¿Puedes vengarme?`;

  return {
    text,
    card: {
      meUsername: params.meUsername,
      meAvatarEmoji: params.meAvatarEmoji,
      meScore: params.meScore,
      rivalUsername: params.rivalUsername,
      rivalAvatarEmoji: params.rivalAvatarEmoji,
      rivalScore: params.rivalScore,
      isTie,
      iWon,
    },
  };
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

  logEvent('challenge_created');
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
  if (row.ok) logEvent('challenge_accepted');
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
      'id, share_token, status, from_user_id, opponent_user_id, target_user_id, source_scan_id, target_scan_id, winner_user_id, is_tie, creator_xp_awarded, opponent_xp_awarded, expires_at',
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
    targetUserId: row.target_user_id,
    winnerUserId: row.winner_user_id,
    isTie: row.is_tie,
    creatorXpAwarded: row.creator_xp_awarded,
    opponentXpAwarded: row.opponent_xp_awarded,
    expiresAt: row.expires_at,
  };
}

// ============================================================
// MIS DESAFÍOS -- historial paginado
// ============================================================
// No hay una tabla de historial separada: `challenges` ya tiene todo lo
// que hace falta (status, scores vía los scans referenciados, ganador,
// fechas) -- confirmado auditando el schema antes de escribir esto. Esto
// solo pagina/enriquece esa misma tabla para la lista, nunca la duplica.

export const CHALLENGE_LIST_PAGE_SIZE = 20;

export interface ChallengeListPage {
  items: ChallengeListItem[];
  hasMore: boolean;
}

interface ChallengeRow {
  id: string;
  share_token: string;
  status: ChallengeListItem['status'];
  from_user_id: string;
  opponent_user_id: string | null;
  target_user_id: string | null;
  source_scan_id: string;
  target_scan_id: string | null;
  winner_user_id: string | null;
  is_tie: boolean;
  creator_xp_awarded: number | null;
  opponent_xp_awarded: number | null;
  created_at: string;
}

export type ChallengeListFilter = 'received' | 'sent' | 'completed' | 'all';

/**
 * Página de "MIS DESAFÍOS" del usuario actual -- ordenados del más reciente
 * al más viejo. `offset`/`limit` en vez de cursor: a esta escala (Challenges
 * por usuario, no Scans) un offset simple alcanza y es mucho más fácil de
 * razonar que un keyset -- si esto alguna vez se vuelve un problema real de
 * escala, se puede migrar sin cambiar la forma de `ChallengeListPage`.
 *
 * `filter` separa el inbox (B) en RECIBIDOS/ENVIADOS/COMPLETADOS -- cada
 * pestaña es su propia query+paginación (offset se resetea al cambiar de
 * pestaña, ver MyChallengesScreen), no un filtro client-side sobre una
 * sola lista cargada de antemano.
 * - 'received': Challenges DIRIGIDOS a mí, todavía 'pending' -- tengo que
 *   responder ACEPTAR/RECHAZAR.
 * - 'sent': lo que yo creé y sigue activo (pending por link esperando que
 *   alguien lo tome, pending dirigido esperando respuesta, o accepted
 *   esperando el Scan de alguien).
 * - 'completed': terminados, sea cual sea mi rol.
 * - 'all' (default): el comportamiento de antes, todo junto.
 *
 * Pide `limit + 1` filas para saber si hay más sin una segunda query de
 * conteo, y resuelve rival/scores con DOS queries batched (`.in(...)`) en
 * vez de N+1 -- a diferencia de getChallenge() (una sola vista, el N+1 ahí
 * no importa), acá sí importaría con 20 filas por página.
 */
export async function listMyChallenges(
  offset = 0,
  limit = CHALLENGE_LIST_PAGE_SIZE,
  filter: ChallengeListFilter = 'all',
): Promise<ChallengeListPage> {
  if (!supabase) return { items: [], hasMore: false };
  const session = await getSession();
  if (!session) return { items: [], hasMore: false };
  const uid = session.user.id;

  let query = supabase
    .from('challenges')
    .select(
      'id, share_token, status, from_user_id, opponent_user_id, target_user_id, source_scan_id, target_scan_id, winner_user_id, is_tie, creator_xp_awarded, opponent_xp_awarded, created_at',
    );

  if (filter === 'received') {
    query = query.eq('target_user_id', uid).eq('status', 'pending');
  } else if (filter === 'sent') {
    query = query.eq('from_user_id', uid).in('status', ['pending', 'accepted']);
  } else if (filter === 'completed') {
    query = query.or(`from_user_id.eq.${uid},opponent_user_id.eq.${uid}`).eq('status', 'completed');
  } else {
    query = query.or(`from_user_id.eq.${uid},opponent_user_id.eq.${uid},target_user_id.eq.${uid}`);
  }

  const { data: rows, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit);

  if (error || !rows) return { items: [], hasMore: false };

  const hasMore = rows.length > limit;
  const pageRows = (hasMore ? rows.slice(0, limit) : rows) as ChallengeRow[];

  const rivalIds = Array.from(
    new Set(
      pageRows
        .map((r) => (r.from_user_id === uid ? r.opponent_user_id ?? r.target_user_id : r.from_user_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const scanIds = Array.from(
    new Set(pageRows.flatMap((r) => [r.source_scan_id, r.target_scan_id]).filter((id): id is string => Boolean(id))),
  );

  const [{ data: profiles }, { data: scans }] = await Promise.all([
    rivalIds.length
      ? supabase.from('public_profiles').select('id, username, avatar_emoji').in('id', rivalIds)
      : Promise.resolve({ data: [] as { id: string; username: string; avatar_emoji: string }[] }),
    scanIds.length
      ? supabase.from('scans').select('id, aura_score').in('id', scanIds)
      : Promise.resolve({ data: [] as { id: string; aura_score: number | null }[] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  // Un scan del rival antes de que el challenge esté 'completed' simplemente
  // no aparece acá (RLS lo filtra, no da error) -- mismo comportamiento que
  // ya usa getChallenge/fetchScanSummary, así que el score queda `null`
  // (mostrado como "···") en vez de romper la fila.
  const scoreByScanId = new Map((scans ?? []).map((s) => [s.id, s.aura_score]));

  const items: ChallengeListItem[] = pageRows.map((r) => {
    const isCreator = r.from_user_id === uid;
    // Un Challenge dirigido que todavía nadie aceptó tiene target_user_id
    // pero opponent_user_id sigue null -- usarlo como fallback para que el
    // CREADOR también vea a quién desafió mientras espera respuesta.
    const rivalId = isCreator ? r.opponent_user_id ?? r.target_user_id : r.from_user_id;
    const rivalProfile = rivalId ? profileById.get(rivalId) : undefined;
    const myScanId = isCreator ? r.source_scan_id : r.target_scan_id;
    const rivalScanId = isCreator ? r.target_scan_id : r.source_scan_id;

    return {
      id: r.id,
      shareToken: r.share_token,
      status: r.status,
      createdAt: r.created_at,
      isCreator,
      myScanId: myScanId ?? null,
      myAuraScore: myScanId ? scoreByScanId.get(myScanId) ?? null : null,
      rival: rivalId && rivalProfile ? { userId: rivalId, username: rivalProfile.username, avatarEmoji: rivalProfile.avatar_emoji } : null,
      rivalAuraScore: rivalScanId ? scoreByScanId.get(rivalScanId) ?? null : null,
      winnerUserId: r.winner_user_id,
      isTie: r.is_tie,
      myXpAwarded: isCreator ? r.creator_xp_awarded : r.opponent_xp_awarded,
      isDirectedToMe: r.target_user_id === uid,
    };
  });

  return { items, hasMore };
}

/**
 * Cuántos Challenges DIRIGIDOS me llegaron y todavía esperan mi
 * ACEPTAR/RECHAZAR -- para el badge de "Recibidos" en Mis Desafíos y el
 * banner de acción urgente en Home (ver auditoría de Home, sección J).
 */
export async function countReceivedChallenges(): Promise<number> {
  if (!supabase) return 0;
  const session = await getSession();
  if (!session) return 0;

  const { count, error } = await supabase
    .from('challenges')
    .select('id', { count: 'exact', head: true })
    .eq('target_user_id', session.user.id)
    .eq('status', 'pending');

  if (error) return 0;
  return count ?? 0;
}

/**
 * Challenge directo real (A) -- crea un Challenge YA dirigido a
 * `targetUsername` vía create_direct_challenge (SECURITY DEFINER, valida
 * dueño/estado del scan, target existente, no auto-desafío -- ver esa
 * migración). Nunca arma nada en el cliente: la única lógica de acá es
 * traducir el resultado de la función a algo que la pantalla pueda leer.
 */
export interface CreateDirectChallengeResult {
  ok: boolean;
  shareToken?: string;
  /** 'not_authenticated' | 'target_not_found' | 'cannot_challenge_self' | 'invalid_scan' | 'rpc_error' */
  errorCode?: string;
}

export async function createDirectChallenge(sourceScanId: string, targetUsername: string): Promise<CreateDirectChallengeResult> {
  if (!supabase) return { ok: false, errorCode: 'rpc_error' };

  const { data, error } = await supabase.rpc('create_direct_challenge', {
    p_source_scan_id: sourceScanId,
    p_target_username: targetUsername,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  if (row.ok) logEvent('challenge_direct_created');
  return { ok: Boolean(row.ok), shareToken: row.share_token ?? undefined, errorCode: row.error_code ?? undefined };
}

/**
 * Responder (aceptar/rechazar) un Challenge dirigido -- vía
 * respond_direct_challenge, SOLO funciona si soy el target_user_id (lo
 * hace cumplir el RPC, no esto). Aceptar deja el Challenge en el mismo
 * estado 'accepted' que ya usa el flujo por link -- nada más downstream
 * necesita distinguir cómo se llegó ahí.
 */
export async function respondDirectChallenge(challengeId: string, accept: boolean): Promise<{ ok: boolean; errorCode?: string }> {
  if (!supabase) return { ok: false, errorCode: 'rpc_error' };

  const { data, error } = await supabase.rpc('respond_direct_challenge', {
    p_challenge_id: challengeId,
    p_accept: accept,
  });
  if (error) return { ok: false, errorCode: 'rpc_error' };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };
  if (row.ok) logEvent(accept ? 'challenge_accepted' : 'challenge_rejected');
  return { ok: Boolean(row.ok), errorCode: row.error_code ?? undefined };
}

/** Notificaciones in-app mínimas (I) -- derivado 100% de `challenges`, sin
 * tabla nueva ni estado leído/no-leído (eso sí necesitaría una tabla
 * liviana -- ver el reporte de esta tarea). Solo el evento "completado"
 * más reciente, porque es el único con timestamp preciso (`resolved_at`);
 * "aceptado" no tiene su propia columna de fecha todavía (`created_at` es
 * de cuando se CREÓ el Challenge, no de cuando lo aceptaron), así que
 * mezclarlo daría un orden cronológico engañoso -- mejor mostrar menos y
 * que sea exacto. */
export type ChallengeResultEventKind = 'won' | 'lost' | 'tie';

export interface ChallengeResultEvent {
  shareToken: string;
  rivalUsername: string;
  kind: ChallengeResultEventKind;
  resolvedAt: string;
}

export async function getLatestChallengeResultEvent(): Promise<ChallengeResultEvent | null> {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;
  const uid = session.user.id;

  const { data: row } = await supabase
    .from('challenges')
    .select('share_token, from_user_id, opponent_user_id, winner_user_id, is_tie, resolved_at')
    .or(`from_user_id.eq.${uid},opponent_user_id.eq.${uid}`)
    .eq('status', 'completed')
    .order('resolved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  const rivalId = row.from_user_id === uid ? row.opponent_user_id : row.from_user_id;
  if (!rivalId) return null;

  const { data: rivalProfile } = await supabase.from('public_profiles').select('username').eq('id', rivalId).maybeSingle();
  if (!rivalProfile) return null;

  const kind: ChallengeResultEventKind = row.is_tie ? 'tie' : row.winner_user_id === uid ? 'won' : 'lost';

  return {
    shareToken: row.share_token,
    rivalUsername: rivalProfile.username,
    kind,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Cuántos Challenges están genuinamente esperando UNA ACCIÓN MÍA ahora
 * mismo: acepté, pero todavía no subí mi Scan. Usado para el badge real de
 * Home ("⚔️ N desafíos pendientes") -- deliberadamente NO cuenta los que
 * estoy esperando que el rival responda (esos no son "mi turno"), para no
 * inflar el número con algo en lo que no hay nada que hacer todavía.
 */
export async function countMyTurnChallenges(): Promise<number> {
  if (!supabase) return 0;
  const session = await getSession();
  if (!session) return 0;

  const { count, error } = await supabase
    .from('challenges')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .eq('opponent_user_id', session.user.id)
    .is('target_scan_id', null);

  if (error) return 0;
  return count ?? 0;
}
