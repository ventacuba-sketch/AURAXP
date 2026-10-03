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
 *
 * Cobertura real del funnel pedido, honesta sobre lo que SÍ y NO se puede
 * instrumentar solo con código de cliente:
 * - app_open, signup_started/completed, login, challenge_created/
 *   challenge_direct_created/challenge_accepted/challenge_rejected,
 *   share/result_shared, first_scan_completed/scan_completed,
 *   profile_viewed, pro_checkout_opened: instrumentados (ver call sites).
 * - challenge_completed: instrumentado, pero SERVER-SIDE (ver
 *   challengeResolution.ts) -- es el único lugar donde "se completó" es
 *   un hecho real y único, sin depender de que cada cliente involucrado
 *   siga conectado en ese momento.
 * - email_confirmed: el evento real ocurre DESPUÉS del click en el email,
 *   fuera de cualquier pantalla de la app (Supabase procesa la
 *   confirmación y redirige) -- no hay un punto de código donde loguear
 *   esto sin agregar una pantalla de callback dedicada solo para eso. Se
 *   puede aproximar por SQL directo: auth.users.email_confirmed_at is not
 *   null ya es ese dato, sin necesitar este evento.
 */
export type AnalyticsEventName =
  | 'app_open'
  // Dashboard de admin (bloque analítica web) -- 'web_visit' es el
  // equivalente de 'app_open' pero para CUALQUIER carga web (con o sin
  // sesión, con o sin utm_*), necesario porque 'app_open' por sí solo no
  // distingue tráfico orgánico/directo del que ya tenía sesión -- ver
  // logWebVisitOnce/captureWebVisit. 'page_viewed' es un evento por cambio
  // de ruta (ver RootNavigator.onStateChange), usado solo para medir
  // profundidad de navegación en el dashboard -- no reemplaza a ningún
  // evento puntual ya existente (profile_viewed, landing_viewed, etc).
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
  // Diagnóstico TEMPORAL (bug real en producción, "No pudimos crear el
  // desafío") -- el error crudo de create_direct_challenge (message/code/
  // details/hint de Postgrest, ya seguro de loguear, ver
  // challengeService.ts) ya se veía en la consola del browser, pero eso
  // exige que alguien abra DevTools en el momento exacto del fallo. Este
  // evento manda lo mismo a `analytics_events`, consultable directo por
  // SQL sin depender de nadie mirando la pantalla -- quitar una vez
  // diagnosticada la causa real (ver el reporte de esta tarea).
  | 'challenge_direct_rpc_error'
  | 'result_shared'
  | 'share'
  | 'profile_viewed'
  | 'pro_checkout_opened'
  // Landing de adquisición (TikTok/Reels/Shorts) -- funnel mínimo pedido:
  // landing_viewed -> landing_cta_clicked -> signup_started/completed (ya
  // existían arriba, sin cambios) -> scan_started (nuevo, ver
  // UploadScreen.handleAnalyze) -> scan_completed (ya existía, ver
  // logScanMilestone). Metadata de estos dos primeros lleva los `utm_*`
  // guardados (ver campaignService.ts) cuando la visita vino de una
  // campaña -- ausente en un `app_open` normal.
  | 'landing_viewed'
  | 'landing_cta_clicked'
  | 'scan_started'
  // PWA (R12) -- solo lo técnicamente confirmable. 'pwa_installed' se
  // loguea en DOS puntos, ambos hechos reales, nunca una suposición: (1)
  // el evento `appinstalled` del navegador (Android/Chrome, confirmado
  // por el propio browser), y (2) detectar `display-mode: standalone` /
  // `navigator.standalone` al ABRIR la app (cubre iOS, donde no existe
  // un evento de "aceptó instalar" -- si más adelante abre en modo
  // standalone, eso SÍ es un hecho verificable de que lo instaló, a
  // diferencia de asumirlo apenas se le muestra la guía). Nunca se loguea
  // un "instalado" solo porque se mostró la guía o el usuario cerró el
  // modal -- ver installService.ts.
  | 'pwa_install_prompt_shown'
  | 'pwa_install_accepted'
  | 'pwa_install_dismissed'
  | 'pwa_installed'
  // Push (bloque pre-lanzamiento, A/F) -- mismo criterio que arriba:
  // 'push_subscribed' solo tras un `pushManager.subscribe()` + upsert en
  // `push_subscriptions` real y exitoso, nunca solo por aceptar el
  // permiso del browser (ver pushService.enablePush).
  | 'push_prompt_shown'
  | 'push_prompt_dismissed'
  | 'push_permission_denied'
  | 'push_subscribed'
  // Wallet/Coins/Social (bloque economía) -- la mayoría de estos se
  // loguean SERVER-SIDE (ver las migraciones 20260905*, mismo criterio
  // que challenge_completed: son hechos que pasan sin depender de que el
  // cliente relevante siga conectado -- wallet_created, coins_earned/
  // coins_spent, mission_completed, referral_activated, item_purchased,
  // gift_sent/gift_received, follow). Los que sí son un solo toque
  // presente del usuario (nunca pueden "perderse") quedan del lado del
  // cliente: referral_sent, store_viewed, item_equipped, unfollow,
  // help_opened, bug_reported, onboarding_completed.
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
  // Chat V2 "Sala Social" -- integrantes + privados con consentimiento
  // (ver chatPrivateService.ts/ChatMembersPanel/ChatPrivateInboxScreen/
  // ChatPrivateConversationScreen). Sin CHECK constraint en event_name
  // (ver comentario de arriba), así que agregar estos nunca pidió tocar
  // ninguna migración de analítica.
  | 'chat_members_opened'
  | 'chat_member_profile_opened'
  | 'chat_private_requested'
  | 'chat_private_request_accepted'
  | 'chat_private_request_rejected'
  | 'chat_private_inbox_opened'
  | 'chat_private_conversation_opened'
  | 'chat_private_message_sent'
  | 'chat_user_blocked'
  // AURA LIVE -- shows en vivo (ver docs/aura-live.md). Varios de estos
  // se loguean SERVER-SIDE desde las RPCs de
  // 20261004000000_aura_live_mvp.sql (live_created/live_started/
  // live_ended/live_comment_sent/live_aura_check_started/
  // live_poll_started/live_vote_cast) -- mismo criterio que
  // chat_message_sent en Chat V1: un hecho real no debe depender de que
  // el cliente relevante siga conectado. El resto (vistas, intentos,
  // reacciones efímeras, prompts) solo existe del lado del cliente.
  | 'live_lobby_viewed'
  | 'live_create_viewed'
  | 'live_start_attempted'
  | 'live_started'
  | 'live_start_failed'
  | 'live_room_viewed'
  | 'live_join_attempted'
  | 'live_joined'
  | 'live_join_failed'
  | 'live_comment_sent'
  | 'live_reaction_sent'
  | 'live_follow_clicked'
  | 'live_share_clicked'
  | 'live_signup_prompted'
  | 'live_guest_converted'
  | 'live_aura_check_started'
  | 'live_aura_check_completed'
  | 'live_aura_check_failed'
  | 'live_poll_started'
  | 'live_vote_cast'
  | 'live_ended';

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
    // NO llamar linkCampaignToCurrentUser() acá (se llamaba antes, gateado
    // por `session && utm`) -- es un RPC completo, y logEvent() corre en
    // CADA evento de analítica de la app (incluido 'page_viewed' en cada
    // cambio de ruta), así que hacerlo acá multiplica llamadas a Supabase
    // sin ganar ningún dato nuevo en las repeticiones (hallazgo H1/H2 de
    // la auditoría del dashboard de admin). La atribución real se liga UNA
    // sola vez por sesión nueva, ver el efecto de sesión en
    // RootNavigator.tsx.
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
    // Nunca debe afectar el flujo real -- ver comentario de arriba.
    trackMetaEvent(eventName, metadata);
  }
}

// Un solo 'app_open' por carga de la app -- App.tsx llama a esto una vez
// al montar; el guard evita duplicados si algo remontara el árbol raíz.
let appOpenLogged = false;
export function logAppOpenOnce(): void {
  if (appOpenLogged) return;
  appOpenLogged = true;
  logEvent('app_open');
}

/** Mismo patrón que logAppOpenOnce, pero para 'web_visit' -- ver el
 * comentario del tipo del evento arriba. Guard en una property de
 * `window` (no un módulo-level boolean como el de arriba) para que
 * sobreviva a un hot-reload en dev sin volver a contar la misma carga. */
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

/** Un 'page_viewed' por cambio de ruta -- ver RootNavigator.onReady/
 * onStateChange. Best-effort como todo lo demás acá, nunca bloquea la
 * navegación real. */
export function logPageView(routeName: string): void {
  void logEvent('page_viewed', { route: routeName });
}

/**
 * Loguea 'first_scan_completed' (una sola vez, el primero) y siempre
 * 'scan_completed' -- un solo count() liviano (usa el índice
 * scans_user_id_idx que ya existe), llamado desde AnalyzingScreen.
 * finishSuccess.
 */
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
    // Best-effort -- ver logEvent().
  }
}

/**
 * true si YO ya logueé un evento 'share' hoy (UTC) -- usado por
 * missionsService para la misión "Comparte 1 resultado" con un evento
 * real, no inventado (posible gracias a la policy de SELECT de los
 * propios eventos agregada en 20260902000000_...).
 */
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
