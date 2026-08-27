/**
 * Small, dependency-free formatting helpers shared across screens.
 */

export function formatXP(xp: number): string {
  return `${xp.toLocaleString()} XP`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function xpProgress(xp: number, xpToNextLevel: number): number {
  if (xpToNextLevel <= 0) return 0;
  return Math.min(1, Math.max(0, xp / xpToNextLevel));
}
