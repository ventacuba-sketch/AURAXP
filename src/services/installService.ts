import { Platform } from 'react-native';

import { logEvent } from './analyticsService';

/**
 * Instalabilidad de AURAXP como PWA (sección R, reescrito en el bloque de
 * fix inmediato tras un bug real reportado en producción -- ver abajo).
 * Todo acá es web-only a propósito (`Platform.OS === 'web'` en cada punto
 * de entrada) -- en nativo `window`/`navigator`/`localStorage` no existen,
 * así que cada función es un no-op seguro fuera de web.
 *
 * BUG REAL de la versión anterior (causa encontrada, no una suposición):
 * el popup vivía DENTRO de HomeScreen (`<InstallPrompt/>`, disparado por
 * `useFocusEffect`) usando un `Modal` (portal). Home es una pantalla del
 * bottom-tabs (`MainTabNavigator`) -- React Navigation NO desmonta tabs
 * inactivos, solo los oculta, así que Home (y el Modal montado adentro)
 * seguía vivo aunque el usuario navegara a Upload/Record/Analyzing/
 * Challenge/etc. Como el `Modal` es un portal, se renderiza ENCIMA de lo
 * que sea que esté activo en ese momento, sin importar el foco real --
 * bastaba con que CUALQUIER navegación de por medio (p. ej. el botón SCAN
 * de BottomNavBar hace `reset({routes:[MainTabs]})` y RECIÉN DESPUÉS
 * `navigate('Upload')`, refocando Home por una fracción de segundo) hiciera
 * que `useFocusEffect` disparara una vez, dejara `visible=true`, y nada
 * jamás lo volvía a poner en `false` al perder foco -- así apareció
 * "cancelando un Challenge" en vez de al volver a Home después del Scan.
 *
 * Fix estructural: el host visual (`InstallInviteHost`, ver ese archivo)
 * ahora vive UNA SOLA VEZ a nivel raíz (sibling de Stack.Navigator, igual
 * que BottomNavBar), nunca dentro de un tab que persiste. Ya no reacciona
 * a foco/navegación -- se muestra SOLO cuando una pantalla real llama
 * `requestInstallInvite(context)` explícitamente, en un puñado de momentos
 * con significado real (ver abajo), y se auto-oculta si la navegación
 * cae en una ruta insegura (Record/Analyzing/Auth/ResetPassword) mientras
 * está abierto.
 *
 * Política centralizada (antes: un cooldown fijo de 7 días, demasiado
 * largo para un usuario nuevo, sin distinguir cuántas veces ya dijo que
 * no). Ahora:
 * - Nunca sin al menos una señal de valor real (recordMeaningfulAction).
 * - Máximo UNA vez por sesión (una carga de página), pase lo que pase.
 * - Después de la primera vez: hace falta otra acción importante (no el
 *   próximo evento inmediato) antes de volver a evaluar.
 * - El piso de tiempo entre apariciones crece con cuántas veces ya cerró
 *   el cartel ("Ahora no"/"Entiendo"): corto al principio, más largo
 *   después de varios rechazos -- nunca insistente para siempre.
 * - Instalación real confirmada (appinstalled o standalone detectado al
 *   abrir) -> nunca más, sin excepción.
 */

// ---- Estado persistido (localStorage, por dispositivo/navegador) ----
const LS_INSTALLED = 'auraxp_pwa_installed';
const LS_VALUE_SIGNAL = 'auraxp_pwa_value_signal';
const LS_DISMISSED_COUNT = 'auraxp_pwa_dismissed_count';
const LS_LAST_SHOWN_AT = 'auraxp_pwa_last_shown_at';
const LS_ACTIONS_SINCE_SHOWN = 'auraxp_pwa_actions_since_shown';
const LS_SESSION_COUNT = 'auraxp_pwa_session_count';

function ls(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Safari en modo privado/con cookies bloqueadas puede tirar acá --
    // el resto de la feature debe seguir andando, solo sin persistencia
    // (en ese caso, sin memoria entre cargas: nunca insistente, en el
    // peor caso solo no recuerda que ya se mostró antes).
    return null;
  }
}

function readNumber(key: string): number {
  const raw = ls()?.getItem(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Standalone real: `display-mode: standalone` cubre Android/Chrome/
 * Desktop instalado; `navigator.standalone` es el equivalente legado de
 * iOS Safari (Apple nunca adoptó el media query estándar).
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

function hasValueSignal(): boolean {
  return ls()?.getItem(LS_VALUE_SIGNAL) === '1';
}

// ---- Sesión: una carga de página real, no cada navegación interna ----
// Se calcula UNA vez al importar el módulo (equivalente a "se abrió la
// app"), no en cada render -- así "próximas sesiones" (A) significa
// literalmente eso, nunca "volvió a la pestaña Home".
let currentSessionCount = 1;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    currentSessionCount = readNumber(LS_SESSION_COUNT) + 1;
    window.localStorage.setItem(LS_SESSION_COUNT, String(currentSessionCount));
  } catch {
    // sin persistencia (ver ls()) -- se trata como primera sesión siempre.
  }
}
export function isLaterSession(): boolean {
  return currentSessionCount >= 2;
}

let shownThisSession = false;

/**
 * Registra una señal de valor real -- llamar SOLO desde un momento
 * genuino (Scan completado, Challenge completado, resultado compartido),
 * nunca desde un render o una navegación de por sí. Idempotente: llamarla
 * varias veces (p. ej. cada Scan, no solo el primero) no rompe nada --
 * cada llamada también cuenta como "otra acción importante" para la
 * política de reaparición (B).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `kind` no
// distingue nada en la política hoy, pero queda tipado en la firma por si
// en el futuro alguna acción debiera pesar distinto (p. ej. un Challenge
// completado siendo una señal más fuerte que un share).
export function recordMeaningfulAction(kind: 'scan_completed' | 'result_shared' | 'challenge_completed'): void {
  ls()?.setItem(LS_VALUE_SIGNAL, '1');
  ls()?.setItem(LS_ACTIONS_SINCE_SHOWN, String(readNumber(LS_ACTIONS_SINCE_SHOWN) + 1));
  // Solo bookkeeping local -- ningún evento de analítica acá a propósito;
  // 'pwa_install_prompt_shown' se loguea únicamente cuando el cartel
  // REALMENTE se muestra (ver requestInstallInvite), no cada vez que se
  // demuestra valor.
}

// Backoff por cuántas veces ya cerró el cartel (B): corto al principio,
// más largo después de varios rechazos -- nunca un cooldown fijo único.
function minGapMsForDismissedCount(n: number): number {
  if (n <= 0) return 0; // primera vez -- sin piso de tiempo, solo la señal de valor importa
  if (n <= 2) return 6 * 60 * 60 * 1000; // 6h -- básicamente "la próxima vez que abra la app"
  if (n <= 5) return 3 * 24 * 60 * 60 * 1000; // 3 días
  return 7 * 24 * 60 * 60 * 1000; // 7 días -- techo para quien ya rechazó muchas veces
}

const ACTIONS_NEEDED_TO_REPEAT = 2; // "después de OTRA acción importante", no la próxima inmediata

function policyAllowsShowingNow(): boolean {
  if (Platform.OS !== 'web') return false;
  if (isStandalone() || hasInstalledFlag()) return false;
  if (shownThisSession) return false; // máximo 1 por sesión, sin excepción
  if (!hasValueSignal()) return false;

  const dismissedCount = readNumber(LS_DISMISSED_COUNT);
  const neededActions = dismissedCount === 0 ? 1 : ACTIONS_NEEDED_TO_REPEAT;
  if (readNumber(LS_ACTIONS_SINCE_SHOWN) < neededActions) return false;

  const gap = Date.now() - readNumber(LS_LAST_SHOWN_AT);
  if (gap < minGapMsForDismissedCount(dismissedCount)) return false;

  return true;
}

type InviteListener = (variant: 'ios' | 'android') => void;
let listener: InviteListener | null = null;

/** El host visual (InstallInviteHost, montado UNA vez a nivel raíz) se
 * suscribe acá -- ver ese archivo. Nunca más de un listener activo a la
 * vez (un solo host real en toda la app). */
export function subscribeInstallInvite(fn: InviteListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Pide mostrar la invitación AHORA, en este `context` -- la política
 * decide si de verdad corresponde (ver policyAllowsShowingNow). Llamar
 * desde cualquier checkpoint real: después de un Scan/Challenge/share
 * completado, al volver a Home en una sesión posterior, o al abrir
 * Perfil. Es seguro llamarla desde varios lugares en la misma sesión --
 * el gate de "máximo 1 por sesión" hace que solo el primero que la pase
 * de verdad muestre algo.
 */
export function requestInstallInvite(context: string): void {
  if (!policyAllowsShowingNow()) return;
  const ios = isIOS();
  if (!ios && !hasNativePrompt()) return; // nunca un botón muerto -- ni la guía de iOS tiene sentido si no es iOS

  shownThisSession = true;
  ls()?.setItem(LS_LAST_SHOWN_AT, String(Date.now()));
  ls()?.setItem(LS_ACTIONS_SINCE_SHOWN, '0');
  listener?.(ios ? 'ios' : 'android');
  logEvent('pwa_install_prompt_shown', { context });
}

export function markInviteDismissed(): void {
  ls()?.setItem(LS_DISMISSED_COUNT, String(readNumber(LS_DISMISSED_COUNT) + 1));
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
