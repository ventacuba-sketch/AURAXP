import { Platform } from 'react-native';

/**
 * Política de reaparición "insistente pero no molesto", compartida por
 * los dos recordatorios contextuales de la app (instalar PWA, activar
 * notificaciones -- ver installService.ts/pushService.ts). Extraída acá
 * porque ambos necesitan EXACTAMENTE la misma mecánica:
 * - nunca sin una señal de valor real primero;
 * - máximo 1 aparición por sesión (una carga de página real), sin
 *   excepción;
 * - después de la primera vez, hace falta OTRA acción importante antes de
 *   volver a ser elegible (nunca el checkpoint inmediato siguiente);
 * - el piso de tiempo entre apariciones escala con cuántas veces ya se
 *   cerró: corto al principio, más largo después de varios rechazos --
 *   nunca un cooldown fijo único.
 * Cada caller pasa su propio `prefix` -> cada feature tiene sus PROPIAS
 * keys en localStorage y su propio "ya se mostró esta sesión" -- nunca
 * comparten estado entre sí (cerrar uno no debe afectar al otro).
 */

function ls(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Safari privado/cookies bloqueadas -- sigue funcionando, solo sin
    // memoria entre cargas (nunca insistente en el peor caso).
    return null;
  }
}

function readNumber(key: string): number {
  const n = Number(ls()?.getItem(key));
  return Number.isFinite(n) ? n : 0;
}

function minGapMsForDismissedCount(n: number): number {
  if (n <= 0) return 0; // primera vez -- sin piso de tiempo, solo la señal de valor importa
  if (n <= 2) return 6 * 60 * 60 * 1000; // 6h -- básicamente "la próxima vez que abra la app"
  if (n <= 5) return 3 * 24 * 60 * 60 * 1000; // 3 días
  return 7 * 24 * 60 * 60 * 1000; // 7 días -- techo para quien ya rechazó muchas veces
}

const ACTIONS_NEEDED_TO_REPEAT = 2;

export interface NudgePolicy {
  /** Llamar desde un momento de valor real (Scan/Challenge completado,
   * share, etc.) -- nunca desde un render o una navegación de por sí. */
  recordAction(): void;
  /** true solo si corresponde mostrar AHORA. `extraGate` es una condición
   * adicional propia del feature (p. ej. "hay algo real que ofrecer") que
   * se evalúa recién si el resto de la política ya lo permitiría --
   * evita, por ejemplo, calcular `hasNativePrompt()` innecesariamente. */
  canShowNow(extraGate?: () => boolean): boolean;
  /** Llamar apenas se decide mostrar de verdad (después de canShowNow). */
  markShown(): void;
  /** Llamar cuando el usuario cierra/rechaza -- pone el próximo piso de tiempo. */
  markDismissed(): void;
}

export function createNudgePolicy(prefix: string): NudgePolicy {
  const LS_VALUE_SIGNAL = `${prefix}_value_signal`;
  const LS_DISMISSED_COUNT = `${prefix}_dismissed_count`;
  const LS_LAST_SHOWN_AT = `${prefix}_last_shown_at`;
  const LS_ACTIONS_SINCE_SHOWN = `${prefix}_actions_since_shown`;
  let shownThisSession = false;

  return {
    recordAction() {
      ls()?.setItem(LS_VALUE_SIGNAL, '1');
      ls()?.setItem(LS_ACTIONS_SINCE_SHOWN, String(readNumber(LS_ACTIONS_SINCE_SHOWN) + 1));
    },
    canShowNow(extraGate) {
      if (Platform.OS !== 'web') return false;
      if (shownThisSession) return false;
      if (ls()?.getItem(LS_VALUE_SIGNAL) !== '1') return false;

      const dismissedCount = readNumber(LS_DISMISSED_COUNT);
      const neededActions = dismissedCount === 0 ? 1 : ACTIONS_NEEDED_TO_REPEAT;
      if (readNumber(LS_ACTIONS_SINCE_SHOWN) < neededActions) return false;

      const gap = Date.now() - readNumber(LS_LAST_SHOWN_AT);
      if (gap < minGapMsForDismissedCount(dismissedCount)) return false;

      if (extraGate && !extraGate()) return false;
      return true;
    },
    markShown() {
      shownThisSession = true;
      ls()?.setItem(LS_LAST_SHOWN_AT, String(Date.now()));
      ls()?.setItem(LS_ACTIONS_SINCE_SHOWN, '0');
    },
    markDismissed() {
      ls()?.setItem(LS_DISMISSED_COUNT, String(readNumber(LS_DISMISSED_COUNT) + 1));
    },
  };
}

// ---- Sesión compartida: una carga de página real, no cada navegación
// interna -- calculada UNA vez al importar (el primer nudgePolicy.ts que
// se importe la fija para todo el resto del boot). Usado por ambos
// features para "volver a abrir en una sesión posterior". ----
const LS_SESSION_COUNT = 'auraxp_session_count';
let currentSessionCount = 1;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    currentSessionCount = readNumber(LS_SESSION_COUNT) + 1;
    window.localStorage.setItem(LS_SESSION_COUNT, String(currentSessionCount));
  } catch {
    // sin persistencia -- se trata como primera sesión siempre.
  }
}
export function isLaterSession(): boolean {
  return currentSessionCount >= 2;
}
