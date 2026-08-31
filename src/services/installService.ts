import { Platform } from 'react-native';

import { logEvent } from './analyticsService';

/**
 * Instalabilidad de AURAXP como PWA (sección R). Todo acá es web-only a
 * propósito (`Platform.OS === 'web'` en cada punto de entrada) -- en
 * nativo `window`/`navigator`/`localStorage` no existen, así que cada
 * función es un no-op seguro fuera de web en vez de asumir el entorno.
 *
 * Estado guardado en localStorage (por dispositivo/navegador, nunca
 * sincronizado -- exactamente lo que R6 pide: "no es un dark pattern
 * porque es local, no una cuenta"):
 * - auraxp_pwa_installed: '1' una vez que hay CONFIRMACIÓN real de
 *   instalación (evento `appinstalled` o detectar standalone al abrir) --
 *   nunca se vuelve a mostrar la invitación después de esto.
 * - auraxp_pwa_dismiss_until: timestamp ms -- "Ahora no" pone un cooldown,
 *   no un rechazo permanente (R6: "puede reaparecer más tarde").
 * - auraxp_pwa_value_signal: '1' -- ya completó al menos un Scan (R5,
 *   la señal de valor real elegida, ver comentario en shouldShowInstallInvite).
 */
const LS_INSTALLED = 'auraxp_pwa_installed';
const LS_DISMISS_UNTIL = 'auraxp_pwa_dismiss_until';
const LS_VALUE_SIGNAL = 'auraxp_pwa_value_signal';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function ls(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Safari en modo privado/con cookies bloqueadas puede tirar acá --
    // el resto de la feature debe seguir andando, solo sin persistencia.
    return null;
  }
}

/**
 * Standalone real: `display-mode: standalone` cubre Android/Chrome/
 * Desktop instalado; `navigator.standalone` es el equivalente legado de
 * iOS Safari (Apple nunca adoptó el media query estándar) -- R8 pide
 * explícitamente detectar ambos.
 */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const mql = window.matchMedia?.('(display-mode: standalone)').matches;
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return Boolean(mql || iosStandalone);
  } catch {
    return false;
  }
}

export function isIOS(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ se reporta como Mac (con soporte táctil) -- el chequeo de
  // maxTouchPoints es la forma real de distinguirlo, no un truco frágil.
  const isIPadOS13Plus = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || isIPadOS13Plus;
}

function hasInstalledFlag(): boolean {
  return ls()?.getItem(LS_INSTALLED) === '1';
}

async function markInstalled(source: 'appinstalled' | 'standalone_detected'): Promise<void> {
  if (hasInstalledFlag()) return; // ya confirmado antes -- no duplicar el evento
  ls()?.setItem(LS_INSTALLED, '1');
  await logEvent('pwa_installed', { source });
}

/** Marca la señal de valor real (R5): completó al menos un Scan. Llamar
 * desde AnalyzingScreen junto a logScanMilestone() -- idempotente, sin
 * problema en llamarla en cada Scan exitoso, no solo el primero. */
export function markValueSignal(): void {
  ls()?.setItem(LS_VALUE_SIGNAL, '1');
}

function hasValueSignal(): boolean {
  return ls()?.getItem(LS_VALUE_SIGNAL) === '1';
}

function isInCooldown(): boolean {
  const raw = ls()?.getItem(LS_DISMISS_UNTIL);
  if (!raw) return false;
  const until = Number(raw);
  return Number.isFinite(until) && Date.now() < until;
}

/** true solo si tiene sentido mostrar la invitación AHORA: web, no
 * instalada ya, ya demostró valor (R5), y no está en cooldown por un
 * "Ahora no" reciente (R6). No exige que exista un beforeinstallprompt
 * capturado -- iOS nunca lo dispara y aun así necesita ver su propia
 * guía (R4). */
export function shouldShowInstallInvite(): boolean {
  if (Platform.OS !== 'web') return false;
  if (isStandalone() || hasInstalledFlag()) return false;
  if (!hasValueSignal()) return false;
  if (isInCooldown()) return false;
  return true;
}

export function markInviteShown(): void {
  logEvent('pwa_install_prompt_shown');
}

export function markInviteDismissed(): void {
  ls()?.setItem(LS_DISMISS_UNTIL, String(Date.now() + DISMISS_COOLDOWN_MS));
  logEvent('pwa_install_dismissed');
}

// ---- Android/Chrome: captura de beforeinstallprompt ----
// Módulo importado una sola vez -> el listener se registra apenas carga
// el bundle web, sin depender de que ningún componente se haya montado
// todavía (el evento puede dispararse antes de que el usuario navegue a
// ningún lado en particular).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Nunca mostrar el mini-infobar nativo del browser sin pedirlo (R3) --
    // preventDefault + guardarlo para disparar SOLO desde nuestro propio CTA.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstalled('appinstalled');
  });
}

export function hasNativePrompt(): boolean {
  return deferredPrompt != null;
}

/** Dispara el prompt nativo de instalación (Android/Chrome/Desktop). Debe
 * llamarse solo tras una interacción real del usuario con NUESTRO CTA
 * (R3) -- el browser exige gesto de usuario de todos modos. */
export async function promptNativeInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null; // un solo uso -- el browser no lo deja reusar
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') {
    logEvent('pwa_install_accepted');
  } else {
    logEvent('pwa_install_dismissed');
  }
  return outcome;
}

/** Registra el service worker (R10) -- SOLO existe para cumplir el
 * criterio de instalabilidad de Android/Chrome (manifest + SW con fetch
 * handler); ver public/sw.js -- no cachea nada, cero riesgo de datos
 * viejos. Llamar una vez al boot de la app (App.tsx). */
export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Best-effort: sin SW, la app sigue funcionando igual, solo sin la
    // mejora de instalabilidad en Android -- nunca debe romper nada.
  });
}

/** Llamar una vez al boot (App.tsx): confirma instalación real vía
 * standalone-al-abrir (R8/R12) -- el único hecho verificable en iOS,
 * donde no existe un evento de "aceptó instalar" como appinstalled. */
export function checkStandaloneOnBoot(): void {
  if (Platform.OS !== 'web') return;
  if (isStandalone()) {
    markInstalled('standalone_detected');
  }
}
