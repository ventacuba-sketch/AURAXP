import { getSession } from './authService';
import { supabase } from './supabaseClient';

/** Analítica best-effort: nunca debe romper el flujo real de la app. */
export type AnalyticsEventName =
  | 'app_open'
  | 'signup_started'
  | 'signup_completed'
  | 'login'
  | 'first_scan_completed'
  | 'scan_completed'
  | 'challenge_created'
  | 'challenge_direct_created'
  | 'challenge_accepted'
  | 'challenge_rejected'
  | 'result_shared'
  | 'share'
  | 'profile_viewed'
  | 'pro_checkout_opened'
  | 'pwa_install_prompt_shown'
  | 'pwa_install_accepted'
  | 'pwa_install_dismissed'
  | 'pwa_installed'
  | 'push_prompt_shown'
  | 'push_prompt_dismissed'
  | 'push_permission_denied'
  | 'push_subscribed'
  | 'email_invite_opened'
  | 'email_invite_sent'
  | 'email_invite_failed';

export async function logEvent(eventName: AnalyticsEventName, metadata?: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  try {
    const session = await getSession();
    await supabase.from('analytics_events').insert({
      event_name: eventName,
      user_id: session?.user.id ?? null,
      metadata: metadata ?? null,
    });
  } catch {
    // Telemetría best-effort.
  }
}

let appOpenLogged = false;
export function logAppOpenOnce(): void {
  if (appOpenLogged) return;
  appOpenLogged = true;
  logEvent('app_open');
}

export async function logScanMilestone(): Promise<void> {
  if (!supabase) return;
  try {
    const session = await getSession();
    if (!session) return;
    const { count } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('status', 'done');
    if (count === 1) await logEvent('first_scan_completed');
    await logEvent('scan_completed', { totalDoneScans: count ?? null });
  } catch {
    // Best-effort.
  }
}

export async function hasSharedToday(): Promise<boolean> {
  if (!supabase) return false;
  const session = await getSession();
  if (!session) return false;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .eq('event_name', 'share')
    .gte('created_at', todayStart.toISOString());

  if (error) return false;
  return (count ?? 0) > 0;
}
