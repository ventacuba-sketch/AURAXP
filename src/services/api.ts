/**
 * Placeholder service layer.
 *
 * This is where Supabase and the AI scoring API will eventually be wired
 * in. For now every function just resolves local mock data (optionally
 * after a short simulated delay) so screens can be built against a stable,
 * realistic-looking async interface without any real backend or network
 * dependency.
 */

import {
  mockAuraChain,
  mockFriendChallenge,
  mockLatestReplay,
  mockScanResult,
  mockUser,
} from './mockData';
import { AuraChain, FriendChallenge, ReplayHighlight, ScanResult, User } from '../types';

export async function fetchCurrentUser(): Promise<User> {
  return mockUser;
}

export async function fetchLatestReplay(): Promise<ReplayHighlight> {
  return mockLatestReplay;
}

export async function fetchFriendChallenge(): Promise<FriendChallenge> {
  return mockFriendChallenge;
}

export async function fetchAuraChain(): Promise<AuraChain> {
  return mockAuraChain;
}

/**
 * Simulates submitting a captured moment for scoring. Resolves the same
 * mock replay result after a short delay — this is what the Analyzing
 * screen waits on before a real AI scoring call replaces it.
 */
export async function submitScan(_mediaUri: string | null): Promise<ScanResult> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(mockScanResult), 1500);
  });
}
