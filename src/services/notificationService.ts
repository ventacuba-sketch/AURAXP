import { getSession } from './authService';
import { supabase } from './supabaseClient';

/**
 * Notificaciones in-app reales -- ver migración
 * 20260901000000_notifications_public_profile_analytics.sql. El texto
 * final ("🏆 Le ganaste a @rival") se arma acá, en el cliente, a partir de
 * kind/result/rivalUsername -- la tabla solo guarda esos datos crudos
 * (mismo criterio que challengeService.getLatestChallengeResultEvent),
 * así nunca hay que migrar filas viejas si cambia la redacción.
 */
export type NotificationKind = 'challenge_accepted' | 'challenge_completed';
export type NotificationResult = 'won' | 'lost' | 'tie';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  challengeShareToken: string | null;
  rivalUsername: string | null;
  rivalAvatarEmoji: string | null;
  result: NotificationResult | null;
  read: boolean;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  challenge_share_token: string | null;
  rival_user_id: string | null;
  result: NotificationResult | null;
  read_at: string | null;
  created_at: string;
}

const DEFAULT_LIMIT = 30;

export async function fetchNotifications(limit = DEFAULT_LIMIT): Promise<AppNotification[]> {
  if (!supabase) return [];
  const session = await getSession();
  if (!session) return [];

  const { data: rows, error } = await supabase
    .from('notifications')
    .select('id, kind, challenge_share_token, rival_user_id, result, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !rows) return [];

  const rivalIds = Array.from(
    new Set((rows as NotificationRow[]).map((r) => r.rival_user_id).filter((id): id is string => Boolean(id))),
  );

  const { data: profiles } = rivalIds.length
    ? await supabase.from('public_profiles').select('id, username, avatar_emoji').in('id', rivalIds)
    : { data: [] as { id: string; username: string; avatar_emoji: string }[] };

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (rows as NotificationRow[]).map((r) => {
    const rival = r.rival_user_id ? profileById.get(r.rival_user_id) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      challengeShareToken: r.challenge_share_token,
      rivalUsername: rival?.username ?? null,
      rivalAvatarEmoji: rival?.avatar_emoji ?? null,
      result: r.result,
      read: r.read_at != null,
      createdAt: r.created_at,
    };
  });
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  if (!supabase) return 0;
  const session = await getSession();
  if (!session) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
}

export async function markAllNotificationsRead(): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
}
