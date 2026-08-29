/**
 * Lista de cuentas de prueba exentas del límite diario de Scans
 * (DAILY_UPLOAD_CAP, ver scoring.ts) -- un solo secret de proyecto
 * (UNLIMITED_TEST_USER_IDS, comma-separated user ids de auth.users),
 * compartido entre todas las Edge Functions que lo necesiten. Vive acá,
 * no duplicado en cada función, para que process-scan (que aplica el
 * límite) y get-daily-scan-status (que lo reporta al frontend) nunca
 * puedan quedar desincronizados sobre quién es una cuenta de prueba.
 *
 * Los secrets de proyecto en Supabase son compartidos por todas las Edge
 * Functions -- no hace falta configurar esto más de una vez.
 */
export const UNLIMITED_TEST_USER_IDS = new Set(
  (Deno.env.get('UNLIMITED_TEST_USER_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

export function isUnlimitedTestUser(userId: string): boolean {
  return UNLIMITED_TEST_USER_IDS.has(userId);
}
