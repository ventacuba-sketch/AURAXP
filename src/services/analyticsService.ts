import { getSession } from './authService';
import { supabase } from './supabaseClient';
import { getCampaignVisitorId, getStoredUtmParams } from './campaignService';

/**
 * Analítica mínima de funnel -- ver migración `analytics_events`
 * (20260901000000_..., ampliada en 20260902000000_...: agrega SELECT de
 * los PROPIOS eventos, usado por missionsService para "Comparte 1
 * resultado"). Solo-inserción para el resto del mundo (sin policy de
 * SELECT de eventos ajenos): el análisis de funnel se hace por SQL con
 * service_role. Best-effort SIEMPRE: un evento de analítica nunca debe
 * romper ni demorar el flujo real de la app, así que cualquier error se
 * traga en silencio (a diferencia del resto de la app, donde silenciar un
 * error sería incorrecto -- acá es exactamente lo correcto, es
 * telemetría, no una acción del usuario). `event_name` no tiene CHECK
 * constraint a propósito -- agregar un evento nuevo nunca necesita
 * migración, solo un valor nuevo acá.
 */
export type AnalyticsEventName =
  | 'app_open'
  | 'web_visit'
  | 'page_viewed'
  | 'signup_viewed'
  | 'signup_started'
  | 'signup_completed'
  | 'login'
  | 'first_scan_completed'
  | 'scan_completed'
  | 'challenge_created'
  | 'challenge_direct_created'
  | 'challenge_accepted'
  | 'challenge_rejected'
  | 'challenge_direct_rpc_error'
  | 'result_shared'
  | 'share'
  | 'profile_viewed'
  | 'pro_checkout_opened'
  | 'landing_viewed'
  | 'landing_cta_clicked'
  | 'landing_chat_clicked'
  | 'scan_started'
  | 'pwa_install_prompt_shown'
  | 'pwa_install_accepted'
  | 'pwa_install_dismissed'
  | 'pwa_installed'
  | 'push_prompt_shown'
  | 'push_prompt_dismissed'
  | 'push_permission_denied'
  | 'push_subscribed'
  | 'wallet_created'
  | 'coins_earned'
  | 'coins_spent'
  | 'mission_completed'
  | 'referral_sent'
  | 'referral_activated'
  | 'store_viewed'
  | 'item_purchased'
  | 'item_equipped'
  | 'gift_sent'
  | 'gift_received'
  | 'follow'
  | 'unfollow'
  | 'help_opened'
  | 'bug_reported'
  | 'onboarding_completed'
  | 'email_invite_opened'
  | 'email_invite_sent'
  | 'email_invite_failed'
  | 'public_result_viewed'
  | 'public_result_voted'
  | 'public_vote_cta_clicked'
  | 'public_battle_viewed'
  | 'public_battle_voted'
  | 'public_battle_cta_clicked'
  | 'chat_viewed'
  | 'chat_guest_created'
  | 'chat_message_sent'
  | 'chat_reaction_added'
  | 'chat_profile_opened'
  | 'chat_signup_prompted'
  | 'chat_signup_started'
  | 'chat_signup_completed'
  | 'chat_scan_cta_clicked'
  | 'chat_first_scan_completed'
  | 'chat_invite_clicked'
  | 'chat_follow_clicked'
  | 'chat_members_opened'
  | 'chat_member_profile_opened'
  | 'chat_private_requested'
  | 'chat_private_request_accepted'
  | 'chat_private_request_rejected'
  | 'chat_private_inbox_opened'
  | 'chat_private_conversation_opened'
  | 'chat_private_message_sent'
  | 'chat_user_blocked'
  | 'client_render_error';

function trackMetaEvent(eventName: AnalyticsEventName, metadata?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const fbq = (window as typeof window & {
    fbq?: (command: string, eventName: string, params?: Record<string, unknown>) => void;
  }).fbq;
  if (typeof fbq !== 'function') return;

  try {
    if (eventName === 'signup_completed') {
      fbq('track', 'CompleteRegistration', metadata);
    } else if (eventName === 'first_scan_completed') {
      fbq('trackCustom', 'ScanCompleted', metadata);
    }
  } catch {
    // Meta telemetry must never affect the AURA VS flow.
  }
}

export async function logEvent(
  eventName: AnalyticsEventName,
  metadata?: Record<string, unknown>,
  userIdOverride?: string | null,
): Promise<void> {
  if (!supabase) return;
  try {
    const session = await getSession();
    const utm = await getStoredUtmParams();
    const visitorId = await getCampaignVisitorId();
    const enrichedMetadata = {
      ...(utm ?? {}),
      ...(visitorId ? { visitor_id: visitorId } : {}),
      ...(metadata ?? {}),
    };
    await supabase.from('analytics_events').insert({
      event_name: eventName,
      user_id: userIdOverride ?? session?.user.id ?? null,
      metadata: Object.keys(enrichedMetadata).length ? enrichedMetadata : null,
    });
    trackMetaEvent(eventName, enrichedMetadata);
  } catch {
    trackMetaEvent(eventName, metadata);
  }
}

let appOpenLogged = false;
export function logAppOpenOnce(): void {
  if (appOpenLogged) return;
  appOpenLogged = true;
  logEvent('app_open');
}

export function logWebVisitOnce(): void {
  if (typeof window === 'undefined') return;
  const key = '__auravs_web_visit_logged__';
  if ((window as typeof window & Record<string, unknown>)[key]) return;
  (window as typeof window & Record<string, unknown>)[key] = true;
  void logEvent('web_visit', {
    path: window.location.pathname,
    referrer: document.referrer || null,
  });
}

export function logPageView(routeName: string): void {
  void logEvent('page_viewed', { route: routeName });
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