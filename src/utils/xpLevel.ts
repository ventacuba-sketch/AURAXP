/**
 * Curva de niveles — DEBE quedar idéntica a
 * `supabase/functions/_shared/scoring.ts` (xpForLevel/computeLevel).
 * Duplicada a propósito: son 10 líneas, no justifica un paquete
 * compartido entre el cliente RN y los Edge Functions Deno.
 */

export function xpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += 100 * n;
  return total;
}

export function computeLevel(totalXp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  return level;
}

/** Para la barra de progreso: XP necesario para el próximo nivel. */
export function xpToNextLevel(totalXp: number): number {
  const level = computeLevel(totalXp);
  return xpForLevel(level + 1);
}
