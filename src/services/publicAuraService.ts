import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type PublicAuraResult = {
  shareId: string;
  auraScore: number;
  verdictTag: string;
  verdictHeadline: string;
  username: string;
  avatarEmoji: string;
  moreVotes: number;
  lessVotes: number;
};

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function createPublicAuraShare(scanId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc('create_scan_public_share', { p_scan_id: scanId });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function fetchPublicAuraResult(token: string): Promise<PublicAuraResult | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc('get_public_scan_result', { p_token: token });
  if (error) throw error;
  const row: any = firstRow(data as any);
  if (!row) return null;
  return {
    shareId: row.share_id,
    auraScore: row.aura_score,
    verdictTag: row.verdict_tag,
    verdictHeadline: row.verdict_headline,
    username: row.username,
    avatarEmoji: row.avatar_emoji ?? '⚡',
    moreVotes: Number(row.more_votes ?? 0),
    lessVotes: Number(row.less_votes ?? 0),
  };
}

async function voterKey(): Promise<string> {
  const storageKey = 'aura_public_voter_key_v1';
  let key = await AsyncStorage.getItem(storageKey);
  if (!key) {
    key = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    await AsyncStorage.setItem(storageKey, key);
  }
  return key;
}

export async function votePublicAuraResult(token: string, vote: 'more' | 'less') {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase no configurado');
  const key = await voterKey();
  const { data, error } = await supabase.rpc('vote_public_scan_result', {
    p_token: token,
    p_vote: vote,
    p_voter_key: key,
  });
  if (error) throw error;
  const row: any = firstRow(data as any);
  return { moreVotes: Number(row?.more_votes ?? 0), lessVotes: Number(row?.less_votes ?? 0) };
}

export function publicAuraUrl(token: string) {
  return `https://auravs.app/r/${encodeURIComponent(token)}`;
}
