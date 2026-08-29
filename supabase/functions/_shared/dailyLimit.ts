/**
 * Fuente ÚNICA de verdad para el límite diario de Scans -- tanto
 * process-scan (lo hace cumplir) como get-daily-scan-status (lo reporta al
 * frontend) importan `resolveDailyCap` de acá. Ningún otro lugar debe
 * recalcular ni duplicar esta lógica: si el número que ve el usuario y el
 * que bloquea el backend salieran de dos sitios distintos, podrían
 * desincronizarse (la UI diciendo una cosa, el backend permitiendo otra).
 *
 * Modelo comercial (ver commit que agregó esto):
 * - FREE, primeros 15 días desde profiles.created_at: 5 Scans/día.
 * - FREE, después: 3 Scans/día.
 * - PRO: comercialmente "ilimitado" -- técnicamente un fair-use de 100/día
 *   para que no sea un backend infinito explotable por automatización.
 *   Ese 100 es un techo de seguridad, no el beneficio que se vende: la UI
 *   nunca debe mostrar "X / 100" a un PRO (ver get-daily-scan-status, que
 *   directamente no manda ese número cuando plan='pro').
 * - Cuentas en UNLIMITED_TEST_USER_IDS: sin cap, cualquiera sea su plan --
 *   mecanismo preexistente, no tocado.
 */

// ── Cuentas de prueba exentas del límite diario ──────────────────────────
// Un solo secret de proyecto (UNLIMITED_TEST_USER_IDS, comma-separated
// user ids de auth.users), compartido entre todas las Edge Functions.
export const UNLIMITED_TEST_USER_IDS = new Set(
  (Deno.env.get('UNLIMITED_TEST_USER_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

export function isUnlimitedTestUser(userId: string): boolean {
  return UNLIMITED_TEST_USER_IDS.has(userId);
}

// ── Constantes del modelo comercial ──────────────────────────────────────
export const FREE_LAUNCH_WINDOW_DAYS = 15;
export const FREE_LAUNCH_DAILY_CAP = 5;
export const FREE_STANDARD_DAILY_CAP = 3;
/** Techo de fair-use interno para PRO -- nunca se muestra en la UI. */
export const PRO_FAIR_USE_DAILY_CAP = 100;

export type PlanTier = 'free' | 'pro';

export interface DailyCapInput {
  plan: PlanTier;
  /** profiles.created_at -- fuente server-side, no manipulable desde el cliente. */
  accountCreatedAt: string;
  unlimitedTestAccount: boolean;
}

export interface DailyCapResult {
  /** Límite efectivo de hoy. Infinity para una cuenta de prueba ilimitada. */
  cap: number;
  /** true solo para PRO (no-test): `cap` es un techo de seguridad interno,
   * nunca el beneficio comercial -- el caller NUNCA debe exponer este
   * número tal cual al usuario cuando esto es true. */
  isFairUseCap: boolean;
  /** true durante la ventana de bienvenida FREE (primeros 15 días). */
  inLaunchWindow: boolean;
  /** Días de bienvenida restantes, redondeado hacia arriba; 0 si no aplica. */
  launchDaysLeft: number;
}

export function resolveDailyCap({ plan, accountCreatedAt, unlimitedTestAccount }: DailyCapInput): DailyCapResult {
  if (unlimitedTestAccount) {
    return { cap: Infinity, isFairUseCap: false, inLaunchWindow: false, launchDaysLeft: 0 };
  }

  if (plan === 'pro') {
    return { cap: PRO_FAIR_USE_DAILY_CAP, isFairUseCap: true, inLaunchWindow: false, launchDaysLeft: 0 };
  }

  const createdMs = new Date(accountCreatedAt).getTime();
  const ageDays = (Date.now() - createdMs) / (24 * 60 * 60 * 1000);
  const inLaunchWindow = Number.isFinite(ageDays) && ageDays < FREE_LAUNCH_WINDOW_DAYS;

  return {
    cap: inLaunchWindow ? FREE_LAUNCH_DAILY_CAP : FREE_STANDARD_DAILY_CAP,
    isFairUseCap: false,
    inLaunchWindow,
    launchDaysLeft: inLaunchWindow ? Math.max(0, Math.ceil(FREE_LAUNCH_WINDOW_DAYS - ageDays)) : 0,
  };
}
