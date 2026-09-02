import { Platform } from 'react-native';

import { logEvent } from './analyticsService';
import { getSession } from './authService';
import { supabase } from './supabaseClient';
import { createNudgePolicy } from '../utils/nudgePolicy';

/**
 * Push notifications reales (A-D del bloque pre-lanzamiento) -- Web Push
 * estándar (Service Worker + PushManager + VAPID), la ÚNICA tecnología
 * que funciona en los tres targets reales de AURAXP (iPhone PWA, Android
 * PWA, y una futura app nativa Expo que también puede consumir Web Push):
 * ni FCM ni APNs directos aplican acá, esos son para apps nativas
 * empaquetadas con sus propios certificados, no una PWA.
 *
 * LIMITACIÓN REAL de iOS (documentada, no un bug): Safari solo soporta
 * Web Push para una PWA YA INSTALADA (Añadir a pantalla de inicio) desde
 * iOS 16.4+ -- nunca en una pestaña normal de Safari sin instalar. Por
 * eso `isPushSupported()` en iPhone depende de `isStandalone()`
 * (installService.ts): mostrar el pre-prompt de notificaciones a alguien
 * con Safari abierto en pestaña sería, como mínimo, un botón que no
 * puede hacer nada -- el mismo principio que ya rige el resto de esta app.
 *
 * Arquitectura idéntica a installService.ts (mismo pub/sub + host raíz +
 * política de reaparición, ver utils/nudgePolicy.ts) -- estado propio
 * (`auraxp_push_*`), nunca comparte cooldown/sesión-mostrada con el
 * recordatorio de instalación (N2 del bloque PWA: son dos mecanismos
 * complementarios, cerrar uno no afecta al otro).
 */

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const policy = createNudgePolicy('auraxp_push');

// Diagnóstico real (bloque investigación "NO DISPONIBLES" en iOS) -- la
// causa encontrada fue exactamente esto: sin el secret de GitHub Actions
// EXPO_PUBLIC_VAPID_PUBLIC_KEY, el build de producción hornea un string
// vacío acá, y `isPushSupported()` da `false` en TODA plataforma (no es
// un problema de iOS específicamente, aunque ahí es donde se notó) --
// mismo resultado visual que "este browser no soporta Web Push", pero
// con una causa completamente distinta y sí corregible (falta config,
// ver el informe). Este log corre una sola vez, solo en web, y no cambia
// ningún comportamiento -- es puramente para que la consola del
// navegador diga la causa real en vez de dejar ambos casos idénticos.
let loggedMissingVapidKey = false;
function warnIfMissingVapidKey(): void {
  if (loggedMissingVapidKey || Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (VAPID_PUBLIC_KEY) return;
  loggedMissingVapidKey = true;
  console.warn(
    '[pushService] Este navegador SÍ soporta Web Push, pero EXPO_PUBLIC_VAPID_PUBLIC_KEY no está configurado en ' +
      'el build -- por eso Perfil muestra "Notificaciones: NO DISPONIBLES" acá. Falta el secret de GitHub Actions ' +
      '(deploy-web.yml) y las claves VAPID correspondientes como secret de la Edge Function send-push en Supabase.',
  );
}

export function isPushSupported(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  warnIfMissingVapidKey();
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(VAPID_PUBLIC_KEY);
}

export type PushPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

/** Estado real para el toggle de Perfil -> Ajustes (F: ACTIVADAS/
 * DESACTIVADAS/NO DISPONIBLES). 'unsupported' cubre TANTO un browser sin
 * Web Push como -- el caso real más común -- un iPhone con Safari en
 * pestaña, todavía no instalado (ver limitación de arriba). */
export function getPermissionState(): PushPermissionState {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission as PushPermissionState;
}

// ============================================================
// BUG CONFIRMADO -- Gestión de Push en Perfil (ver auditoría previa)
// ============================================================
// `getPermissionState()` de arriba SOLO lee `Notification.permission` --
// un permiso del SO, sticky para siempre hasta que la persona lo cambie
// a mano desde Ajustes de iOS. Perfil lo usaba solo a ESO para decidir
// "ACTIVADAS", sin verificar que existiera una PushSubscription real ni
// que estuviera sincronizada con `push_subscriptions` -- por eso
// @Cubanito veía "ACTIVADAS" con 0 filas reales en la tabla, y tocar
// DESACTIVAR no cambiaba nada visible (desuscribe del browser, pero el
// permiso del SO -- lo único que leía la UI -- nunca se mueve).
//
// `getPushUiStatus()` es el reemplazo: el ÚNICO estado que debe pintar
// Perfil de acá en adelante. 'on' exige las TRES cosas a la vez --
// permiso, PushSubscription real en el browser, Y (best-effort) que esa
// suscripción esté sincronizada server-side -- nunca solo el permiso.
export type PushUiStatus = 'unsupported' | 'off' | 'requires_reactivation' | 'on';

/** Suscripción real del browser, si existe -- null en cualquier otro
 * caso (no soportado, SW no listo, sin suscripción). Nunca lanza. */
async function getBrowserSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Punto 5 (auditoría) -- una suscripción creada con una VAPID key vieja
 * (de antes de que EXPO_PUBLIC_VAPID_PUBLIC_KEY existiera en el build, o
 * de una rotación de claves) queda atascada para siempre si simplemente
 * se reutiliza: el push service la rechaza (403) y `send-push` no tiene
 * forma de distinguir eso de un error transitorio, así que nunca se
 * revoca sola (ver auditoría de send-push). Comparación best-effort:
 * `PushSubscriptionOptions.applicationServerKey` no está disponible en
 * TODOS los browsers -- si no se puede leer, no bloquea (nunca romper
 * algo que hoy funciona por no poder verificarlo), asume que coincide.
 */
function subscriptionMatchesCurrentVapidKey(subscription: PushSubscription): boolean {
  try {
    const key = subscription.options?.applicationServerKey;
    if (!key || !VAPID_PUBLIC_KEY) return true;
    const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const keyBytes = new Uint8Array(key as ArrayBuffer);
    if (keyBytes.length !== current.length) return false;
    for (let i = 0; i < keyBytes.length; i++) {
      if (keyBytes[i] !== current[i]) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Punto 1 ("preferiblemente sincronizada con push_subscriptions") --
 * confirma que la suscripción del browser tiene una fila ACTIVA
 * (revoked_at null) del usuario logueado. Best-effort real: sin sesión,
 * sin Supabase, o si la query falla (red), devuelve `null` ("no se pudo
 * verificar") en vez de `false` -- un hiccup de red nunca debe hacer que
 * alguien vea "REQUIERE REACTIVAR" con una suscripción en realidad sana.
 */
async function isSubscriptionSyncedServerSide(endpoint: string): Promise<boolean | null> {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', endpoint)
      .eq('user_id', session.user.id)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) return null;
    return Boolean(data);
  } catch {
    return null;
  }
}

/**
 * Estado real para pintar Perfil -- reemplaza a `getPermissionState()`
 * como fuente de "ACTIVADAS/DESACTIVADAS/REQUIERE REACTIVAR/NO
 * DISPONIBLES" (punto 1/4 de la auditoría). 'on' exige permiso +
 * PushSubscription real + sincronía server-side confirmada -- si
 * cualquiera de las tres falta, nunca es 'on'.
 *
 * 'requires_reactivation' (punto 4) es el caso puntual reportado: permiso
 * ya concedido por el SO, pero sin una suscripción real detrás (nunca se
 * completó, se perdió, o quedó atada a una VAPID key vieja -- punto 5).
 * Se distingue de 'off' (permiso ni pedido, o denegado) porque ahí SÍ
 * alcanza con tocar "Activar" de nuevo -- no hace falta re-pedir permiso
 * nativo, `enablePush()` lo resuelve solo.
 */
export async function getPushUiStatus(): Promise<PushUiStatus> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return 'off';

  const subscription = await getBrowserSubscription();
  if (!subscription) return 'requires_reactivation';
  if (!subscriptionMatchesCurrentVapidKey(subscription)) return 'requires_reactivation';

  const synced = await isSubscriptionSyncedServerSide(subscription.endpoint);
  if (synced === false) return 'requires_reactivation';

  return 'on';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Flujo real de activación (F): pedir el permiso nativo del browser Y,
 * si lo concede, suscribirse de verdad (PushManager + guardar la
 * suscripción en `push_subscriptions`) -- las dos cosas cuentan como una
 * sola acción desde la UI (ver NotificationSheet), nunca se pide el
 * permiso nativo sin que la persona ya haya visto nuestro pre-prompt
 * propio primero (eso lo decide el caller, acá solo se ejecuta).
 *
 * Nota real sobre el caso de dispositivo compartido: si el mismo
 * endpoint del navegador ya pertenece a OTRO usuario (alguien más se
 * suscribió antes desde el mismo browser/dispositivo y no cerró sesión
 * limpiamente), el upsert puede fallar por RLS (cada quien administra
 * solo sus propias filas, ver la migración) -- caso de borde real, no
 * resuelto acá; se loguea y se trata como fallo silencioso, nunca rompe
 * el resto de la app.
 */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported() || !supabase) return false;
  const session = await getSession();
  if (!session) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      logEvent('push_permission_denied');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    let existing = await registration.pushManager.getSubscription();

    // Punto 5 (auditoría) -- nunca reutilizar ciegamente una suscripción
    // vieja atada a otra VAPID key: el push service la rechaza para
    // siempre (403, indistinguible de un error transitorio en send-push,
    // ver auditoría) y nadie se entera. Se da de baja acá y se fuerza una
    // suscripción nueva con la key ACTUAL.
    if (existing && !subscriptionMatchesCurrentVapidKey(existing)) {
      await existing.unsubscribe().catch(() => {});
      existing = null;
    }

    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // as BufferSource: los tipos DOM de TS son más estrictos que el
        // runtime real acá (Uint8Array<ArrayBufferLike> vs el
        // ArrayBufferView<ArrayBuffer> que exige el lib.dom.d.ts más
        // nuevo) -- todo browser real acepta un Uint8Array plano sin
        // problema, es un desajuste de tipos, no de comportamiento.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: session.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        platform: 'web',
        last_seen: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'endpoint' },
    );

    if (error) {
      console.error(JSON.stringify({ src: 'enablePush', event: 'upsert_failed', message: error.message }));
      return false;
    }

    logEvent('push_subscribed');
    return true;
  } catch (e) {
    console.error(JSON.stringify({ src: 'enablePush', event: 'error', message: String(e) }));
    return false;
  }
}

/** Perfil -> Ajustes -> NOTIFICACIONES: DESACTIVAR real (no solo dejar de
 * mostrar el recordatorio) -- desuscribe del browser Y marca la fila
 * revocada server-side, para que send-push deje de intentarle de
 * inmediato en vez de esperar a que el navegador devuelva 404/410.
 *
 * Punto 2 (auditoría) -- además de revocar por `endpoint` (caso normal),
 * revoca TODAS las filas activas del usuario logueado como red de
 * seguridad: si por lo que sea el browser ya no tiene la suscripción
 * pero quedó una fila server-side huérfana (el caso inverso al bug
 * reportado, nunca observado pero posible), DESACTIVAR converge igual a
 * "sin filas activas" -- nunca deja algo a medias. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    if (supabase) {
      const session = await getSession();
      if (session) {
        await supabase
          .from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('user_id', session.user.id)
          .is('revoked_at', null);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ src: 'disablePush', event: 'error', message: String(e) }));
  }
}

/** Señal de valor real -- ver installService.recordMeaningfulAction, el
 * mismo criterio, estado propio (no comparte cooldown con la instalación). */
export function recordMeaningfulAction(): void {
  policy.recordAction();
}

type InviteListener = () => void;
let listener: InviteListener | null = null;

export function subscribeNotificationInvite(fn: InviteListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Pide mostrar el pre-prompt propio AHORA (F) -- nunca el prompt nativo
 * directo. Nunca si: no soportado (incl. iPhone no instalado, ver
 * arriba), permiso ya resuelto (granted/denied -- ahí ya no hay pre-
 * prompt que mostrar, solo el toggle de Ajustes tiene sentido), o ya se
 * preguntó antes en este dispositivo (evita re-preguntar por Ajustes
 * después de un "Ahora no" -- eso ya tiene su propia política de
 * reaparición vía `policy`, no debería sumarse un segundo gate).
 */
/** Devuelve true si de verdad mostró el pre-prompt -- ver el comentario
 * equivalente en installService.requestInstallInvite (se encadenan). */
export function requestNotificationInvite(context: string): boolean {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'default') return false; // ya se resolvió -- nada que pre-preguntar
  if (!policy.canShowNow()) return false;

  policy.markShown();
  listener?.();
  logEvent('push_prompt_shown', { context });
  return true;
}

export function markInviteDismissed(): void {
  policy.markDismissed();
  logEvent('push_prompt_dismissed');
}
