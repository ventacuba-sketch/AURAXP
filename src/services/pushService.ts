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
    const existing = await registration.pushManager.getSubscription();
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
 * inmediato en vez de esperar a que el navegador devuelva 404/410. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      if (supabase) {
        await supabase.from('push_subscriptions').update({ revoked_at: new Date().toISOString() }).eq('endpoint', endpoint);
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
