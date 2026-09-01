import { getSession } from './authService';
import { supabase } from './supabaseClient';

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
  | 'push_subscribed';

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
    // Nunca debe afectar el flujo real -- ver comentario de arriba.
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
