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
  // Tier real para 8,420 según Scoring v1 (EXCELENTE = 6,000-8,499) — el
  // tag y el XP quedan consistentes con la fórmula, no inventados.
  verdictTag: 'EXCELENTE',
  verdictHeadline: 'Mirar atrás te costó llegar a los 10K.',
  auraScore: 8420,
  xpAwarded: 110, // XP_BASE(50) + bonus EXCELENTE(60)
  timeline: [
    { time: '0:01', delta: 1500, label: 'ENTRADA FRÍA' },
    { time: '0:02', delta: 900, label: 'CERO DUDA' },
    { time: '0:04', delta: 2400, label: 'TIMING PERFECTO' },
    { time: '0:05', delta: -600, label: 'MIRASTE ATRÁS' },
    { time: '0:06', delta: 1900, label: 'SALIDA LIMPIA' },
  ],
  stats: {
    confidence: 91,
    style: 84,
    timing: 90,
    cringeRisk: 18,
  },
  createdAt: new Date().toISOString(),
  // Sin backend real no hay ningún video que reproducir -- el botón de
  // play en AURA REPLAY queda deshabilitado en modo mock.
  videoPath: null,
};

export const mockAuraChain: AuraChain = {
  names: ['Tú', 'Carlos', 'Ana', 'Leo'],
};
