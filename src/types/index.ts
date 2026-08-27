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
 */
export type RootStackParamList = {
  MainTabs: undefined;
  Upload: undefined;
  Analyzing: undefined;
  ScanResult: { scanId?: string } | undefined;
  Challenge: undefined;
};

export interface User {
  id: string;
  username: string;
  avatarEmoji: string;
  founderNumber: string; // e.g. "00428" -> shown as "FOUNDER #00428"
  level: number;
  xp: number;
  xpToNextLevel: number;
  streakDays: number;
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

/** The four mini stats shown under a scored replay. */
export interface AuraStats {
  confidence: number;
  style: number;
  timing: number;
  cringeRisk: number;
}

export type ScanVerdict = 'verified' | 'pending' | 'rejected';

/** A scored "Aura Replay" — the result of running a moment through AURAXP. */
export interface ScanResult {
  id: string;
  verdict: ScanVerdict;
  verdictHeadline: string; // "Almost legendary. Looking back cost you the 10K."
  xpEarned: number;
  timeline: TimelineEvent[];
  stats: AuraStats;
  createdAt: string;
}

/** A chain of friends who've passed a challenge along. */
export interface AuraChain {
  names: string[]; // ["You", "Carlos", "Ana", "Leo"]
}
