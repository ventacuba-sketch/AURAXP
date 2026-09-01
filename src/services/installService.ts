import { Platform } from 'react-native';

import { logEvent } from './analyticsService';
import { createNudgePolicy, isLaterSession } from '../utils/nudgePolicy';

export { isLaterSession };

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
const policy = createNudgePolicy('auraxp_pwa');

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

/**
 * Registra una señal de valor real -- llamar SOLO desde un momento
 * genuino (Scan completado, Challenge completado, resultado compartido),
 * nunca desde un render o una navegación de por sí. Idempotente: llamarla
 * varias veces (p. ej. cada Scan, no solo el primero) no rompe nada --
 * cada llamada también cuenta como "otra acción importante" para la
 * política de reaparición (B). Política compartida con el recordatorio
 * de notificaciones (ver utils/nudgePolicy.ts) -- misma mecánica, estado
 * propio (`auraxp_pwa_*`), nunca se pisan entre sí.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `kind` no
// distingue nada en la política hoy, pero queda tipado en la firma por si
// en el futuro alguna acción debiera pesar distinto (p. ej. un Challenge
// completado siendo una señal más fuerte que un share).
export function recordMeaningfulAction(kind: 'scan_completed' | 'result_shared' | 'challenge_completed'): void {
  policy.recordAction();
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
 * decide si de verdad corresponde. Llamar desde cualquier checkpoint
 * real: después de un Scan/Challenge/share completado, al volver a Home
 * en una sesión posterior, o al abrir Perfil. Es seguro llamarla desde
 * varios lugares en la misma sesión -- el gate de "máximo 1 por sesión"
 * hace que solo el primero que la pase de verdad muestre algo.
 */
/** Devuelve true si de verdad mostró algo -- los checkpoints que llaman
 * TANTO a esto como a pushService.requestNotificationInvite() usan el
 * valor de retorno para encadenarlos (mostrar como mucho uno de los dos
 * por checkpoint, nunca los dos compitiendo a la vez). */
export function requestInstallInvite(context: string): boolean {
  if (isStandalone() || hasInstalledFlag()) return false;
  const ios = isIOS();
  // nunca un botón muerto -- ni la guía de iOS tiene sentido si no es iOS
  if (!policy.canShowNow(() => ios || hasNativePrompt())) return false;

  policy.markShown();
  listener?.(ios ? 'ios' : 'android');
  logEvent('pwa_install_prompt_shown', { context });
  return true;
}

export function markInviteDismissed(): void {
  policy.markDismissed();
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
