/**
 * Shared domain types for AURAXP.
 *
 * These describe the shape of data the UI expects. For this MVP everything
 * is backed by placeholder/mock data (see `src/services`) instead of a real
 * backend or AI API.
 */

/** Bottom tabs — always-available destinations. */
export type MainTabParamList = {
  Home: undefined;
  Scan: undefined;
  Profile: undefined;
};

/**
 * Root stack — hosts the tab navigator plus the flow screens that get
 * pushed on top of it: Home/Scan -> Upload/Capture -> Analyzing ->
 * ScanResult (Aura Replay) -> Challenge / Share.
 *
 * `challengeToken` rides along into Upload when the flow started from
 * accepting a shared challenge, so the finished scan can be linked back
 * to it. `scanId` is the real backend scan, created by Upload before it
 * navigates to Analyzing — when absent (Supabase not configured yet),
 * both Analyzing and ScanResult fall back to mock data.
 */
export type RootStackParamList = {
  MainTabs: undefined;
  Upload:
    | {
        challengeToken?: string;
        /** Vuelta desde Record con un video recién grabado (ver RecordScreen). */
        recordedUri?: string;
        recordedDurationMs?: number;
      }
    | undefined;
  Record: { challengeToken?: string } | undefined;
  Analyzing: { scanId?: string } | undefined;
  ScanResult: { scanId?: string } | undefined;
  Challenge: { scanId?: string } | undefined;
  ChallengeLanding: { token: string };
  /** Solo registrada en el navigator cuando no hay sesión — ver RootNavigator. */
  Auth: undefined;
};

export interface User {
  id: string;
  username: string;
  avatarEmoji: string;
  bio: string | null;
  founderNumber: string; // e.g. "00428" -> shown as "FOUNDER #00428"
  level: number;
  xp: number;
  xpToNextLevel: number;
  streakDays: number;
  /** null = todavía no cambió el username desde que existe esta columna -> puede hacerlo ya. */
  usernameUpdatedAt: string | null;
}

/** A short, timestamped highlight surfaced on Home ("Latest Replay"). */
export interface ReplayHighlight {
  id: string;
  xpDelta: number;
  momentLabel: string; // "Cold entrance"
  timestamp: string; // relative time, e.g. "2h ago"
}

/** A friend's outstanding challenge — shown on Home and on the Challenge (versus) screen. */
export interface FriendChallenge {
  id: string;
  friendName: string;
  friendScore: number;
  prompt: string; // "Can you beat it?"
}

/** One scored beat inside a replay's breakdown timeline. */
export interface TimelineEvent {
  time: string; // "0:01"
  delta: number; // positive or negative XP
  label: string; // "COLD ENTRANCE"
}

/** The four mini stats shown under a scored replay, each on a 0-100 scale. */
export interface AuraStats {
  confidence: number;
  style: number;
  timing: number;
  cringeRisk: number;
}

export type ScanVerdict = 'verified' | 'pending' | 'rejected';

/**
 * A scored "Aura Replay" — the result of running a moment through AURAXP.
 *
 * `auraScore` and `xpAwarded` are deliberately separate numbers: Aura
 * measures how good/bad THIS moment was (can be negative, is what gets
 * shared/challenged); XP is the small, always-positive amount that adds
 * to the user's lifetime progression. Never conflate the two.
 */
export interface ScanResult {
  id: string;
  verdict: ScanVerdict;
  verdictTag: string; // short, punchy verdict — "CASI LEGENDARIO"
  verdictHeadline: string; // one-line explanation — "Mirar atrás te costó llegar a los 10K."
  auraScore: number;
  xpAwarded: number;
  timeline: TimelineEvent[];
  stats: AuraStats;
  createdAt: string;
  /** Ruta del video en Supabase Storage (bucket "scans"), no una URL — el
   * bucket es privado, así que hace falta mintear una signed URL para
   * reproducirlo (ver getVideoPlaybackUrl en scanService.ts). null en modo
   * mock o si el scan no tiene video asociado. */
  videoPath: string | null;
}

/** A chain of friends who've passed a challenge along. */
export interface AuraChain {
  names: string[]; // ["You", "Carlos", "Ana", "Leo"]
}

/** Public preview of a shared challenge — served by get-challenge-preview, no auth needed. */
export interface ChallengePreview {
  fromUsername: string;
  fromAvatarEmoji: string;
  auraScore: number;
  verdictTag: string;
}
