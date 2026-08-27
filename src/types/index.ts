/**
 * Shared domain types for AURAXP.
 *
 * These describe the shape of data the UI expects. For this first scaffold
 * they're backed by placeholder/mock data (see `src/services`) instead of
 * a real backend or AI API.
 */

export type RootTabParamList = {
  Home: undefined;
  Upload: undefined;
  ScanResult: { scanId?: string } | undefined;
  Challenge: undefined;
  Profile: undefined;
};

export interface User {
  id: string;
  username: string;
  avatarEmoji: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  streakDays: number;
}

export type ChallengeStatus = 'active' | 'completed' | 'locked';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  status: ChallengeStatus;
  emoji: string;
}

export type ScanVerdict = 'verified' | 'pending' | 'rejected';

export interface ScanResult {
  id: string;
  challengeTitle: string;
  verdict: ScanVerdict;
  xpEarned: number;
  confidence: number; // 0-1
  createdAt: string;
}
