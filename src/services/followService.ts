import { supabase } from './supabaseClient';

/**
 * Follow/Following (H) -- todo por username, nunca un id crudo (el
 * cliente jamás tiene el id técnico de otro usuario, ver
 * get_public_profile/walletService -- mismo principio acá). Sin Aura/XP
 * de por medio: seguir a alguien es puramente social.
 */

export interface FollowStats {
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
}

export async function fetchFollowStats(username: string): Promise<FollowStats> {
  const empty = { followersCount: 0, followingCount: 0, isFollowing: false };
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc('get_public_follow_stats', { p_username: username });
  if (error || !data) return empty;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return empty;
  return {
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    isFollowing: Boolean(row.is_following),
  };
}

export interface FollowListEntry {
  username: string;
  avatarEmoji: string;
  level: number;
}

export async function fetchFollowers(username: string): Promise<FollowListEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_followers_list', { p_username: username });
  if (error || !data) return [];
  return data.map((r: { username: string; avatar_emoji: string; level: number }) => ({
    username: r.username,
    avatarEmoji: r.avatar_emoji,
    level: r.level,
  }));
}

export async function fetchFollowing(username: string): Promise<FollowListEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_following_list', { p_username: username });
  if (error || !data) return [];
  return data.map((r: { username: string; avatar_emoji: string; level: number }) => ({
    username: r.username,
    avatarEmoji: r.avatar_emoji,
    level: r.level,
  }));
}

export async function followUser(username: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('follow_user', { p_target_username: username });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}

export async function unfollowUser(username: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('unfollow_user', { p_target_username: username });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.ok);
}
