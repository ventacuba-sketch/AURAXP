/**
 * Placeholder service layer.
 *
 * This is where Supabase and the AI scoring API will eventually be wired
 * in. For now every function just resolves local mock data so screens can
 * be built against a stable, realistic-looking async interface without any
 * real backend or network dependency.
 */

import { mockChallenges, mockScanResult, mockUser } from './mockData';
import { Challenge, ScanResult, User } from '../types';

export async function fetchCurrentUser(): Promise<User> {
  return mockUser;
}

export async function fetchChallenges(): Promise<Challenge[]> {
  return mockChallenges;
}

export async function submitScan(_mediaUri: string): Promise<ScanResult> {
  // TODO: replace with a real upload + AI scoring call.
  return mockScanResult;
}
