/**
 * Small, dependency-free formatting helpers shared across screens.
 */

export function formatXP(xp: number): string {
  return `${xp.toLocaleString()} XP`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/** "+1,500" / "-600" — used for score deltas (timeline beats, challenge scores). */
export function formatSignedXP(value: number): string {
  return value >= 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

/** "LVL 07" — zero-padded, matches the app's all-caps label style. */
export function formatLevel(level: number): string {
  return `LVL ${String(level).padStart(2, '0')}`;
}

export function xpProgress(xp: number, xpToNextLevel: number): number {
  if (xpToNextLevel <= 0) return 0;
  return Math.min(1, Math.max(0, xp / xpToNextLevel));
}
