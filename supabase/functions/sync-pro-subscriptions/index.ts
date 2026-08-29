/**
 * sync-pro-subscriptions — el mecanismo REAL de activación de PRO (ver
 * _shared/dlocalGo.ts para de dónde sale cada detalle de la API de dLocal
 * Go, y por qué esto es una sincronización por email y no un webhook con
 * referencia propia: el checkout es un link fijo, no lleva ningún
 * identificador de AURAXP).
 *
 * DOS MODOS, cada uno con su propio alcance de escritura:
 *
 * 1) Con JWT de usuario (Authorization: Bearer <access_token> normal) --
 *    lo llama el propio cliente, típicamente al volver a la app después
 *    de completar (o abandonar) el checkout externo (ver planService.ts y
 *    ProScreen -- se dispara solo, con AppState, nunca con un botón "ya
 *    pagué"). Solo puede activar/confirmar SU PROPIO plan: se compara el
 *    email de la sesión contra las suscripciones de dLocal, y el UPDATE
 *    de `profiles` va siempre sobre `auth.uid()` -- nunca sobre un id
 *    resuelto a partir del email, así que no hay forma de que esto
 *    termine tocando la cuenta de otra persona aunque el email matchee
 *    mal.
 *
 * 2) Con el secret compartido (mismo DLOCAL_WEBHOOK_SECRET que
 *    dlocal-webhook, reusado a propósito -- evita pedir un segundo
 *    secret solo para esto) -- sincronización completa: recorre TODAS las
 *    suscripciones del plan y actualiza cualquier perfil que matchee por
 *    email (vía find_profile_id_by_email(), ver la migración). Pensado
 *    para correr periódicamente (cron) -- no configurado automáticamente
 *    todavía, ver el mensaje final de la tarea que agregó esto.
 *
 * Idempotente en ambos modos: re-sincronizar una cuenta ya PRO con la
 * misma suscripción activa vuelve a escribir los mismos valores (no-op
 * real); `pro_started_at` se fija UNA sola vez (solo cuando está en null)
 * así que nunca se pisa la fecha real de alta en una renovación; una
 * suscripción inactiva SOLO puede bajar a un perfil que ya tenía
 * exactamente ese pro_subscription_id -- nunca toca una cuenta por una
 * coincidencia de email vieja/ajena.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { DlocalGoConfig, DlocalGoSubscription, listAllSubscriptions } from '../_shared/dlocalGo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Mismo secret que ya usa dlocal-webhook -- ver ese archivo para el motivo
// de reusarlo en vez de pedir uno nuevo por función.
const SHARED_SECRET = Deno.env.get('DLOCAL_WEBHOOK_SECRET') ?? '';

// El plan_id es literalmente el último tramo del checkout link fijo que ya
// usa la app (ver planService.ts) -- no hace falta un secret nuevo solo
// para esto, pero se puede pisar con un env var si algún día cambia.
const DEFAULT_PLAN_ID = '3JLKd9wEHw5un0ueS8q6PTNkig6QZQde';
const DLOCAL_PLAN_ID = Deno.env.get('DLOCAL_PLAN_ID') || DEFAULT_PLAN_ID;
const DLOCAL_ENVIRONMENT = (Deno.env.get('DLOCAL_ENVIRONMENT') === 'sandbox' ? 'sandbox' : 'production') as
  | 'production'
  | 'sandbox';
const DLOCAL_API_KEY = Deno.env.get('DLOCAL_API_KEY') ?? '';
const DLOCAL_API_SECRET = Deno.env.get('DLOCAL_API_SECRET') ?? '';

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ src: 'sync-pro-subscriptions', event, ...data }));
}

type AdminClient = ReturnType<typeof createClient>;

/** Activa/refresca PRO para un perfil puntual -- misma lógica sea cual sea
 * el modo que la llame. Dos UPDATEs a propósito: el primero es seguro de
 * repetir en cada renovación (siempre pisa lo mismo); el segundo solo
 * corre si `pro_started_at` sigue en null, así la fecha de alta real
 * nunca se mueve una vez fijada. */
async function activateProfile(admin: AdminClient, profileId: string, subscriptionId: string): Promise<void> {
  await admin
    .from('profiles')
    .update({ plan: 'pro', pro_status: 'active', pro_provider: 'dlocal', pro_subscription_id: subscriptionId })
    .eq('id', profileId);
  await admin
    .from('profiles')
    .update({ pro_started_at: new Date().toISOString() })
    .eq('id', profileId)
    .is('pro_started_at', null);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!DLOCAL_API_KEY || !DLOCAL_API_SECRET) {
    // Bloqueo externo real -- no hay credenciales de la API de dLocal Go
    // configuradas todavía. No es un error del código: no hay nada más
    // que esta función pueda hacer sin ellas. 200 a propósito (no 500):
    // el modo "propio usuario" lo llama la app en segundo plano en cada
    // vuelta del checkout, y un 5xx repetido ahí no debería ensuciar logs
    // como si fuera una falla real del sistema.
    log('missing_credentials');
    return jsonResponse({ ok: false, reason: 'dlocal_not_configured', activated: false });
  }

  const dlocalConfig: DlocalGoConfig = {
    apiKey: DLOCAL_API_KEY,
    apiSecret: DLOCAL_API_SECRET,
    environment: DLOCAL_ENVIRONMENT,
    planId: DLOCAL_PLAN_ID,
  };

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Modo 2: secret compartido -- sincronización completa ────────────
  const providedSecret = req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('secret') ?? '';
  if (SHARED_SECRET && providedSecret === SHARED_SECRET) {
    try {
      const subscriptions: DlocalGoSubscription[] = await listAllSubscriptions(dlocalConfig);
      let activated = 0;
      let deactivated = 0;

      for (const sub of subscriptions) {
        if (sub.active) {
          if (!sub.client_email) continue;
          const { data: profileId } = await admin.rpc('find_profile_id_by_email', { p_email: sub.client_email });
          if (!profileId) continue;
          await activateProfile(admin, profileId as string, sub.id);
          activated++;
        } else {
          const { error, count } = await admin
            .from('profiles')
            .update({ plan: 'free', pro_status: 'canceled' }, { count: 'exact' })
            .eq('pro_subscription_id', sub.id);
          if (!error && (count ?? 0) > 0) deactivated++;
        }
      }

      log('full_sync_done', { totalSubscriptions: subscriptions.length, activated, deactivated });
      return jsonResponse({ ok: true, totalSubscriptions: subscriptions.length, activated, deactivated });
    } catch (e) {
      log('full_sync_failed', { error: String(e) });
      return jsonResponse({ ok: false, error: 'sync_failed' }, 502);
    }
  }

  // ── Modo 1: JWT de usuario -- solo el propio plan ────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user || !user.email) {
    return jsonResponse({ error: 'No autenticado' }, 401);
  }

  try {
    const subscriptions = await listAllSubscriptions(dlocalConfig);
    const mine = subscriptions.find(
      (sub) => sub.active && sub.client_email && sub.client_email.toLowerCase() === user.email!.toLowerCase(),
    );

    if (!mine) {
      log('self_sync_no_match', { userId: user.id });
      return jsonResponse({ ok: true, activated: false });
    }

    await activateProfile(admin, user.id, mine.id);
    log('self_sync_activated', { userId: user.id });
    return jsonResponse({ ok: true, activated: true });
  } catch (e) {
    log('self_sync_failed', { userId: user.id, error: String(e) });
    return jsonResponse({ ok: false, error: 'sync_failed' }, 502);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
