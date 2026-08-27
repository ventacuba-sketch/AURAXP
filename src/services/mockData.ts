/**
 * Temporary placeholder data.
 *
 * No Supabase, no AI scoring API — nothing here talks to a network. This
 * exists purely so screens have something realistic to render while the
 * real services are built. Replace with real API calls in a later step.
 */

import { Challenge, ScanResult, User } from '../types';

export const mockUser: User = {
  id: 'u_001',
  username: 'ventacuba',
  avatarEmoji: '🦋',
  level: 7,
  xp: 2450,
  xpToNextLevel: 3000,
  streakDays: 5,
};

export const mockChallenges: Challenge[] = [
  {
    id: 'c_001',
    title: 'Morning Run',
    description: 'Post a 1km+ run before 9am.',
    xpReward: 150,
    status: 'active',
    emoji: '🏃',
  },
  {
    id: 'c_002',
    title: 'Hydrate Check',
    description: 'Scan a full water bottle 3x today.',
    xpReward: 80,
    status: 'active',
    emoji: '💧',
  },
  {
    id: 'c_003',
    title: 'Touch Grass',
    description: 'Log 20 minutes outside, no phone.',
    xpReward: 120,
    status: 'completed',
    emoji: '🌿',
  },
  {
    id: 'c_004',
    title: 'Night Owl Ban',
    description: 'Lights out before midnight, 3 nights in a row.',
    xpReward: 200,
    status: 'locked',
    emoji: '🌙',
  },
];

export const mockScanResult: ScanResult = {
  id: 's_001',
  challengeTitle: 'Morning Run',
  verdict: 'verified',
  xpEarned: 150,
  confidence: 0.94,
  createdAt: new Date().toISOString(),
};
