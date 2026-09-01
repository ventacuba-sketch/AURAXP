/**
 * Placeholder / real service layer, side by side.
 *
 * `fetchCurrentUser` uses the real Supabase profile once configured
 * (see supabaseClient.isSupabaseConfigured), falling back to mock data
 * otherwise — so the app keeps working before the backend is wired up.
 *
 * `fetchFriendChallenge` / `fetchAuraChain` stay mock-only on purpose: an
 * "incoming challenge inbox" and a real Aura Chain graph were explicitly
 * deferred out of this MVP's approved scope (Challenge is link-only for
 * now). `submitScan` is the mock fallback used by AnalyzingScreen when
 * there's no real scanId to poll.
 *
 * `fetchLatestReplay` USES to be mock-only too -- real bug found testing
 * on device: Home's "Ver replay" always opened a hardcoded mock scan
 * (id "s_001", not a real row), so DESAFIAR A UN AMIGO from there tried
 * to create a Challenge with that fake id as source_scan_id and failed
 * the scans(id) foreign key -- caught as the generic "No pudimos crear
 * el desafío". Now real once Supabase+session are available, same
 * pattern as fetchCurrentUser.
 */

import {
  mockAuraChain,
  mockFriendChallenge,
  mockLatestReplay,
  mockScanResult,
  mockUser,
} from './mockData';
import { supabase } from './supabaseClient';
import { computeLevel, xpToNextLevel } from '../utils/xpLevel';
import { formatRelativeTime } from '../utils/format';
import { AuraChain, FriendChallenge, ReplayHighlight, ScanResult, User } from '../types';

export async function fetchCurrentUser(): Promise<User> {
  if (!supabase) return mockUser;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return mockUser;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  if (error || !profile) return mockUser;

  return {
    id: profile.id,
    username: profile.username,
    avatarEmoji: profile.avatar_emoji,
    bio: profile.bio ?? null,
    founderNumber: String(profile.founder_number).padStart(5, '0'),
    level: computeLevel(profile.xp),
    xp: profile.xp,
    xpToNextLevel: xpToNextLevel(profile.xp),
    streakDays: 0, // no hay tracking de racha real todavía — fuera de alcance
    usernameUpdatedAt: profile.username_updated_at ?? null,
  };
}

/**
 * El scan `done` más reciente del usuario actual, como "ÚLTIMO REPLAY".
 * `null` (no mock) cuando hay sesión real pero todavía no tiene ningún
 * Scan terminado -- Home ya sabe ocultar la card entera con `{latestReplay
 * && ...}`, mejor eso que mostrar un replay que no existe.
 */
export async function fetchLatestReplay(): Promise<ReplayHighlight | null> {
  if (!supabase) return mockLatestReplay;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return mockLatestReplay;

  const { data: scan, error } = await supabase
    .from('scans')
    .select('id, aura_score, verdict_tag, created_at')
    .eq('user_id', session.user.id)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !scan) return null;

  return {
    id: scan.id,
    xpDelta: scan.aura_score ?? 0,
    momentLabel: scan.verdict_tag ?? '',
    timestamp: formatRelativeTime(scan.created_at),
  };
}

export async function fetchFriendChallenge(): Promise<FriendChallenge> {
  return mockFriendChallenge;
}

export async function fetchAuraChain(): Promise<AuraChain> {
  return mockAuraChain;
}

/** How long the mock scan takes — used only by the no-backend fallback path. */
export const SCAN_DURATION_MS = 1500;

/**
 * Fallback usado por AnalyzingScreen cuando no hay backend configurado
 * (sin scanId real para hacer polling). Una vez Supabase está armado,
 * el flujo real pasa por scanService.uploadAndSubmitScan + getScan.
 */
export async function submitScan(_mediaUri: string | null): Promise<ScanResult> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(mockScanResult), SCAN_DURATION_MS);
  });
}
