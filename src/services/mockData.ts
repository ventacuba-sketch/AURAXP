/**
 * Temporary placeholder data.
 *
 * No Supabase, no AI scoring API — nothing here talks to a network. This
 * exists purely so screens have something realistic to render while the
 * real services are built. Replace with real API calls in a later step.
 */

import {
  AuraChain,
  FriendChallenge,
  ReplayHighlight,
  ScanResult,
  User,
} from '../types';

export const mockUser: User = {
  id: 'u_001',
  username: 'ventacuba',
  avatarEmoji: '🦋',
  founderNumber: '00428',
  level: 7,
  xp: 24680,
  xpToNextLevel: 30000,
  streakDays: 5,
};

export const mockLatestReplay: ReplayHighlight = {
  id: 'r_001',
  xpDelta: 8420,
  momentLabel: 'Entrada fría',
  timestamp: 'Hace 2h',
};

export const mockFriendChallenge: FriendChallenge = {
  id: 'fc_001',
  friendName: 'Carlos',
  friendScore: 8730,
  prompt: '¿Puedes superarlo?',
};

export const mockScanResult: ScanResult = {
  id: 's_001',
  verdict: 'verified',
  verdictHeadline: 'Casi legendario. Mirar atrás te costó llegar a los 10K.',
  xpEarned: 8420,
  timeline: [
    { time: '0:01', delta: 1500, label: 'ENTRADA FRÍA' },
    { time: '0:02', delta: 900, label: 'CERO DUDA' },
    { time: '0:04', delta: 2400, label: 'TIMING PERFECTO' },
    { time: '0:05', delta: -600, label: 'MIRASTE ATRÁS' },
    { time: '0:06', delta: 1900, label: 'SALIDA LIMPIA' },
  ],
  stats: {
    confidence: 9.1,
    style: 8.4,
    timing: 9.0,
    cringeRisk: 1.8,
  },
  createdAt: new Date().toISOString(),
};

export const mockAuraChain: AuraChain = {
  names: ['Tú', 'Carlos', 'Ana', 'Leo'],
};
