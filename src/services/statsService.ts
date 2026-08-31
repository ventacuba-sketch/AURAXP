import { supabase } from './supabaseClient';

/**
 * Perfil social mínimo (F) + Ranking (G) -- ambos vía las funciones
 * SECURITY DEFINER de la migración 20260831120000_challenge_stats_and_
 * leaderboard.sql. Nunca se calcula esto trayendo todos los Challenges/
 * Scans al cliente: sería caro y, peor, expondría filas de otros usuarios
 * que RLS hoy no deja leer directo -- las funciones ya devuelven el
 * agregado listo.
 */
export interface ChallengeStats {
  challengesCompleted: number;
  wins: number;
  losses: number;
  ties: number;
  /** null si el usuario todavía no tiene ningún Scan `done`. */
  bestAuraScore: number | null;
  avgAuraScore: number | null;
}

interface ChallengeStatsRow {
  challenges_completed: number;
  wins: number;
  losses: number;
  ties: number;
  best_aura_score: number | null;
  avg_aura_score: number | null;
}

export async function fetchMyChallengeStats(): Promise<ChallengeStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_challenge_stats').single();
  if (error || !data) return null;
  const row = data as ChallengeStatsRow;

  return {
    challengesCompleted: row.challenges_completed ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    ties: row.ties ?? 0,
    bestAuraScore: row.best_aura_score ?? null,
    avgAuraScore: row.avg_aura_score != null ? Number(row.avg_aura_score) : null,
  };
}

export interface LeaderboardEntry {
  username: string;
  avatarEmoji: string;
  xp: number;
  level: number;
  rank: number;
}

export async function fetchXpLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_xp_leaderboard', { p_limit: limit });
  if (error || !data) return [];

  return (data as { username: string; avatar_emoji: string; xp: number; level: number; rank: number }[]).map((row) => ({
    username: row.username,
    avatarEmoji: row.avatar_emoji,
    xp: row.xp,
    level: row.level,
    rank: row.rank,
  }));
}

/** null sin sesión -- todo usuario con perfil tiene SIEMPRE un rank real
 * (hasta el último puesto), así que null acá específicamente significa
 * "no se pudo consultar", no "no tiene ranking". */
export async function fetchMyXpRank(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_xp_rank');
  if (error || data == null) return null;
  return Number(data);
}

export interface AuraLeaderboardEntry {
  username: string;
  avatarEmoji: string;
  bestAuraScore: number;
  rank: number;
}

export async function fetchAuraLeaderboard(limit = 20): Promise<AuraLeaderboardEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_aura_leaderboard', { p_limit: limit });
  if (error || !data) return [];

  return (data as { username: string; avatar_emoji: string; best_aura_score: number; rank: number }[]).map((row) => ({
    username: row.username,
    avatarEmoji: row.avatar_emoji,
    bestAuraScore: row.best_aura_score,
    rank: row.rank,
  }));
}

export async function fetchMyAuraRank(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_aura_rank');
  if (error || data == null) return null;
  return Number(data);
}

/** Perfil público mínimo de CUALQUIER usuario -- ver get_public_profile
 * (RPC, solo columnas ya aprobadas como públicas: nunca email/plan/id). */
export interface PublicProfile {
  username: string;
  avatarEmoji: string;
  level: number;
  xp: number;
  bestAuraScore: number | null;
  challengesCompleted: number;
  wins: number;
  losses: number;
  ties: number;
}

interface PublicProfileRow {
  username: string;
  avatar_emoji: string;
  level: number;
  xp: number;
  best_aura_score: number | null;
  challenges_completed: number;
  wins: number;
  losses: number;
  ties: number;
}

export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_profile', { p_username: username }).maybeSingle();
  if (error || !data) return null;
  const row = data as PublicProfileRow;

  return {
    username: row.username,
    avatarEmoji: row.avatar_emoji,
    level: row.level,
    xp: row.xp,
    bestAuraScore: row.best_aura_score,
    challengesCompleted: row.challenges_completed,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
  };
}
