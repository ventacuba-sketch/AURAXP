import { hasSharedToday } from './analyticsService';
import { getSession } from './authService';
import { fetchDailyScanStatus } from './scanService';
import { supabase } from './supabaseClient';

/**
 * Misiones diarias simples (I) -- SOLO visuales, sin XP: otorgar XP extra
 * acá complicaría el anti-farming/economía actual (ver auditoría), así
 * que por ahora es puro feedback de progreso. Cada misión sale de un
 * evento REAL ya existente, nunca de un estado inventado en el cliente:
 * - Scan: el mismo contador que ya usa DailyScanCounter
 *   (get-daily-scan-status).
 * - Challenge completado hoy: un Challenge mío resuelto hoy (resolved_at).
 * - Compartir: un evento 'share' de analytics_events de hoy (posible
 *   gracias a la policy de SELECT de los propios eventos).
 */
export interface DailyMissions {
  scanDone: boolean;
  challengeCompletedToday: boolean;
  sharedToday: boolean;
}

async function hasCompletedChallengeToday(): Promise<boolean> {
  if (!supabase) return false;
  const session = await getSession();
  if (!session) return false;
  const uid = session.user.id;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('challenges')
    .select('id', { count: 'exact', head: true })
    .or(`from_user_id.eq.${uid},opponent_user_id.eq.${uid}`)
    .eq('status', 'completed')
    .gte('resolved_at', todayStart.toISOString());

  if (error) return false;
  return (count ?? 0) > 0;
}

export async function fetchDailyMissions(): Promise<DailyMissions | null> {
  if (!supabase) return null;

  const [scanStatus, challengeDone, sharedToday] = await Promise.all([
    fetchDailyScanStatus(),
    hasCompletedChallengeToday(),
    hasSharedToday(),
  ]);

  if (!scanStatus) return null;

  return {
    scanDone: scanStatus.count > 0,
    challengeCompletedToday: challengeDone,
    sharedToday,
  };
}
