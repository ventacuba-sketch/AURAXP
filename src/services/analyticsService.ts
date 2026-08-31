import { getSession } from './authService';
import { supabase } from './supabaseClient';

/**
 * Loguea 'first_scan' o 'second_scan' según cuántos Scans 'done' tiene ya
 * el usuario -- un solo count() liviano (usa el índice scans_user_id_idx
 * que ya existe), llamado una vez desde AnalyzingScreen.finishSuccess.
 * Silenciosamente no hace nada a partir del tercer Scan -- el funnel
 * pedido solo necesita distinguir "llegó al primero" de "volvió una
 * segunda vez", no contar cada Scan subsiguiente.
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
    if (count === 1) await logEvent('first_scan');
    else if (count === 2) await logEvent('second_scan');
  } catch {
    // Best-effort -- ver logEvent().
  }
}

/**
 * Analítica mínima de funnel -- ver migración `analytics_events`
 * (20260901000000_...). Solo-inserción desde el cliente (sin policy de
 * SELECT: nadie puede leer eventos de vuelta desde acá, el análisis se
 * hace por SQL con service_role). Best-effort SIEMPRE: un evento de
 * analítica nunca debe romper ni demorar el flujo real de la app, así que
 * cualquier error se traga en silencio (a diferencia del resto de la app,
 * donde silenciar un error sería incorrecto -- acá es exactamente lo
 * correcto, es telemetría, no una acción del usuario).
 *
 * Cubre el funnel pedido en la medida en que es instrumentable de forma
 * confiable SOLO con código de cliente:
 * - 'signup', 'first_scan'/'second_scan', 'challenge_created',
 *   'challenge_accepted', 'share', 'pro_checkout_opened': instrumentados
 *   (ver los call sites).
 * - 'visit': NO instrumentado -- requeriría trackear cada montaje de
 *   ChallengeLanding/Auth como "visita", lo cual mide sesiones de Chromium
 *   en este sandbox, no visitas reales; se deja la tabla lista pero sin
 *   este evento en particular, para no ensuciar la métrica con datos de
 *   testing.
 * - 'email_confirmed': el evento real ocurre DESPUÉS del click en el
 *   email, fuera de cualquier pantalla de la app (Supabase procesa la
 *   confirmación y redirige) -- no hay un punto de código donde "loguear
 *   esto" sin agregar una pantalla de callback dedicada solo para esto.
 *   Se puede aproximar por SQL directamente: auth.users.email_confirmed_at
 *   is not null ya es ese dato, sin necesitar este evento.
 */
export type AnalyticsEventName =
  | 'signup'
  | 'first_scan'
  | 'second_scan'
  | 'challenge_created'
  | 'challenge_accepted'
  | 'share'
  | 'pro_checkout_opened';

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
