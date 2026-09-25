import { Platform } from 'react-native';

import { logEvent } from './analyticsService';
import { getSession } from './authService';
import { isIOS, isStandalone } from './installService';
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
  // Bug real confirmado (auditoría "push desactivado al entrar por
  // Safari/WhatsApp"): en iOS 16.4+, Safari expone `serviceWorker`/
  // `PushManager`/`Notification` en el `window` incluso en una pestaña
  // normal o en el navegador embebido de WhatsApp/TikTok -- pero Apple
  // solo deja que el push REALMENTE funcione desde una PWA instalada
  // (standalone). Sin este chequeo, esos contextos pasaban el resto de
  // esta función, y como el permiso ahí es 'default' (iOS lo aísla por
  // instalación, separado de Safari), `getPushUiStatus()` devolvía 'off'
  // -- Perfil mostraba "DESACTIVADAS" como si la persona lo hubiera
  // apagado a mano, en vez de "NO DISPONIBLES" (este contexto no puede
  // soportarlo, punto). Android no cambia: ahí sí funciona desde una
  // pestaña normal, por eso el chequeo es específico de iOS.
  if (isIOS() && !isStandalone()) return false;
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
 * Segundo bug confirmado (auditoría) -- REQUIERE REACTIVAR se queda en
 * REQUIERE REACTIVAR después de tocar Activar, con 0 filas en
 * push_subscriptions. `enablePush()` devolvía un boolean plano: ni la
 * consola ni la UI decían EN QUÉ PASO fallaba (SW no listo, subscribe()
 * rechazado, upsert rechazado por RLS/red, etc.) -- imposible diagnosticar
 * sin acceso a un iPhone real. `step` es diagnóstico interno (nunca se le
 * muestra tal cual a la persona -- ver ProfileScreen, que lo traduce a un
 * texto corto); `detail` es el mensaje técnico exacto para consola/logs,
 * SIN secretos (nunca p256dh/auth -- son las claves de cifrado de la
 * suscripción -- ni la VAPID key completa, ni el endpoint completo).
 */
export type EnablePushFailureStep =
  | 'not_supported'
  | 'no_session'
  | 'permission_denied'
  | 'sw_not_ready'
  | 'subscribe_failed'
  | 'invalid_subscription'
  | 'upsert_failed'
  | 'unexpected_error';

export interface EnablePushResult {
  ok: boolean;
  step?: EnablePushFailureStep;
  detail?: string;
}

function logPush(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ src: 'enablePush', event, ...data }));
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
 * solo sus propias filas, ver la migración) -- caso de borde real,
 * ahora SÍ visible como 'upsert_failed' en vez de perderse en silencio.
 */
export async function enablePush(): Promise<EnablePushResult> {
  if (!isPushSupported()) return { ok: false, step: 'not_supported' };
  if (!supabase) return { ok: false, step: 'not_supported', detail: 'Supabase no configurado' };

  const session = await getSession();
  if (!session) return { ok: false, step: 'no_session' };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      logEvent('push_permission_denied');
      return { ok: false, step: 'permission_denied' };
    }

    logPush('sw_ready_wait');
    const registration = await navigator.serviceWorker.ready;
    logPush('sw_ready_ok', { scope: registration.scope });

    let existing = await registration.pushManager.getSubscription();
    logPush('get_subscription_result', { found: Boolean(existing) });

    // Punto 5 (auditoría) -- nunca reutilizar ciegamente una suscripción
    // vieja atada a otra VAPID key: el push service la rechaza para
    // siempre (403, indistinguible de un error transitorio en send-push,
    // ver auditoría) y nadie se entera. Se da de baja acá y se fuerza una
    // suscripción nueva con la key ACTUAL.
    if (existing && !subscriptionMatchesCurrentVapidKey(existing)) {
      logPush('stale_vapid_key_detected');
      await existing.unsubscribe().catch(() => {});
      existing = null;
    }

    let subscription: PushSubscription;
    if (existing) {
      subscription = existing;
    } else {
      // applicationServerKey se construye SIEMPRE acá, a partir de
      // EXPO_PUBLIC_VAPID_PUBLIC_KEY -- si esa variable llegó vacía o mal
      // formada al build, esto es lo que revienta (y ahora queda
      // registrado como 'subscribe_failed', nunca silencioso). No se
      // loguea el valor -- no es secreto (es la clave PÚBLICA), pero no
      // aporta nada al diagnóstico y es ruido -- solo su longitud, para
      // confirmar que efectivamente llegó algo al build.
      let applicationServerKey: BufferSource;
      try {
        applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource;
        logPush('application_server_key_built', { vapidPublicKeyLength: VAPID_PUBLIC_KEY.length });
      } catch (e) {
        logPush('application_server_key_build_failed', { message: String(e) });
        return { ok: false, step: 'subscribe_failed', detail: 'VAPID key inválida (no se pudo decodificar)' };
      }

      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // as BufferSource: los tipos DOM de TS son más estrictos que el
          // runtime real acá (Uint8Array<ArrayBufferLike> vs el
          // ArrayBufferView<ArrayBuffer> que exige el lib.dom.d.ts más
          // nuevo) -- todo browser real acepta un Uint8Array plano sin
          // problema, es un desajuste de tipos, no de comportamiento.
          applicationServerKey,
        });
        logPush('subscribe_ok');
      } catch (e) {
        // Error EXACTO del navegador -- p. ej. DOMException 'AbortError'
        // (VAPID key rechazada) o 'NotAllowedError'. Nunca se pierde en
        // el catch genérico de más abajo.
        const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        logPush('subscribe_failed', { detail });
        return { ok: false, step: 'subscribe_failed', detail };
      }
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      logPush('invalid_subscription_json', {
        hasEndpoint: Boolean(json.endpoint),
        hasP256dh: Boolean(json.keys?.p256dh),
        hasAuth: Boolean(json.keys?.auth),
      });
      return { ok: false, step: 'invalid_subscription' };
    }

    // Cuarto bug confirmado (auditoría) -- con el onConflict ya
    // corregido (user_id,endpoint), el upsert seguía en 400. Causa real:
    // el payload mandaba `platform` y `last_seen` -- dos columnas que
    // NO EXISTEN en la tabla real de producción (esquema real
    // confirmado: id/user_id/endpoint/p256dh/auth/created_at/updated_at/
    // revoked_at -- sin platform, sin last_seen). Misma migración de
    // este repo (20260904000000) las declara, pero producción quedó
    // aplicada distinto -- mismo patrón de drift ya documentado en otras
    // tablas de este proyecto. PostgREST rechaza con 400 cualquier
    // columna que no exista en su schema cache -- exactamente el error
    // reportado. `updated_at` no se manda: no hay forma de confirmar
    // desde acá si tiene un trigger propio que la actualiza sola (lo más
    // común en Supabase) o si espera un valor explícito -- mandar un
    // valor inventado sin saberlo sería peor que omitirlo, y la columna
    // no es NOT NULL según el esquema real que se confirmó.
    const payload = {
      user_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      revoked_at: null as string | null,
    };
    // Payload exacto que se intenta guardar -- p256dh/auth NUNCA en
    // claro, solo si están presentes y su longitud (para confirmar que
    // llegó algo real sin exponer las claves de cifrado).
    logPush('upsert_payload', {
      user_id: payload.user_id,
      endpointHost: (() => {
        try {
          return new URL(payload.endpoint).host;
        } catch {
          return null;
        }
      })(),
      p256dhPresent: Boolean(payload.p256dh),
      p256dhLength: payload.p256dh?.length ?? 0,
      authPresent: Boolean(payload.auth),
      authLength: payload.auth?.length ?? 0,
    });

    const { error } = await supabase.from('push_subscriptions').upsert(payload, { onConflict: 'user_id,endpoint' });

    if (error) {
      // Error EXACTO del upsert -- message/code/details/hint completos
      // de PostgREST/Postgres. Nunca incluye p256dh/auth.
      console.error(
        JSON.stringify({
          src: 'enablePush',
          event: 'upsert_failed',
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        }),
      );
      const detail = [error.code, error.message].filter(Boolean).join(': ') || 'error desconocido';
      return { ok: false, step: 'upsert_failed', detail };
    }

    logEvent('push_subscribed');
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(JSON.stringify({ src: 'enablePush', event: 'unexpected_error', detail }));
    return { ok: false, step: 'unexpected_error', detail };
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
