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

/** "Hace 2h" / "Hace 3d" / "Justo ahora" -- usado por el "ÚLTIMO REPLAY" real de Home. */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Justo ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}
