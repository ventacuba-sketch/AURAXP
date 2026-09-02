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
export type NotificationKind =
  | 'challenge_accepted'
  | 'challenge_completed'
  | 'challenge_received'
  | 'challenge_rejected'
  | 'referral_activated'
  | 'new_follower'
  | 'gift_received';
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
  /** Solo en 'gift_received' -- nombre/emoji del regalo, resueltos vía
   * gifts.gift_id -> gifts.gift_key -> store_items (ver fetchNotifications).
   * null si esta notificación no es un regalo, o si es una fila vieja de
   * antes de que gift_id existiera (bug UX corregido -- ver migración
   * 20260907000000): en ese caso el caller cae al texto/comportamiento
   * genérico anterior, nunca rompe. */
  giftName: string | null;
  giftAssetRef: string | null;
}

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  challenge_share_token: string | null;
  rival_user_id: string | null;
  gift_id: string | null;
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
    .select('id, kind, challenge_share_token, rival_user_id, gift_id, result, read_at, created_at')
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

  // Bug UX (gift_received sin detalle) -- resuelve gift_id -> gift_key ->
  // catálogo (nombre/emoji), en dos queries batched (no N+1). RLS de
  // `gifts` (gifts_select_involved) ya cubre "soy el recipient" -- mismo
  // criterio que el resto de este archivo (RLS hace el trabajo, esto solo
  // arma el shape). Si algo no resuelve (fila vieja sin gift_id, ítem
  // desactivado desde entonces), giftName/giftAssetRef quedan null y el
  // caller cae al texto/comportamiento genérico de antes -- nunca rompe.
  const giftIds = Array.from(
    new Set((rows as NotificationRow[]).map((r) => r.gift_id).filter((id): id is string => Boolean(id))),
  );
  const { data: gifts } = giftIds.length
    ? await supabase.from('gifts').select('id, gift_key').in('id', giftIds)
    : { data: [] as { id: string; gift_key: string }[] };
  const giftKeyById = new Map((gifts ?? []).map((g) => [g.id, g.gift_key]));

  const giftKeys = Array.from(new Set((gifts ?? []).map((g) => g.gift_key)));
  const { data: giftItems } = giftKeys.length
    ? await supabase.from('store_items').select('item_key, name, asset_ref').in('item_key', giftKeys)
    : { data: [] as { item_key: string; name: string; asset_ref: string | null }[] };
  const giftItemByKey = new Map((giftItems ?? []).map((i) => [i.item_key, i]));

  return (rows as NotificationRow[]).map((r) => {
    const rival = r.rival_user_id ? profileById.get(r.rival_user_id) : undefined;
    const giftKey = r.gift_id ? giftKeyById.get(r.gift_id) : undefined;
    const giftItem = giftKey ? giftItemByKey.get(giftKey) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      challengeShareToken: r.challenge_share_token,
      rivalUsername: rival?.username ?? null,
      rivalAvatarEmoji: rival?.avatar_emoji ?? null,
      result: r.result,
      read: r.read_at != null,
      createdAt: r.created_at,
      giftName: giftItem?.name ?? null,
      giftAssetRef: giftItem?.asset_ref ?? null,
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
