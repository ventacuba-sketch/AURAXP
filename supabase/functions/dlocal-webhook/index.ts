/**
 * dlocal-webhook — punto de integración PREPARADO, NO ACTIVO todavía.
 *
 * ============================================================
 * POR QUÉ NO ACTIVA PRO TODAVÍA (leer antes de tocar este archivo)
 * ============================================================
 * El checkout de dLocal Go que usa la app hoy es un link ESTÁTICO y
 * genérico (mismo link para cualquier usuario:
 * https://checkout.dlocalgo.com/validate/subscription/<planId>), sin
 * ningún identificador de AURAXP viajando en la URL. Eso significa que,
 * aunque dLocal mande un webhook real acá, este código NO tiene manera
 * confiable de saber a qué fila de `profiles` corresponde ese pago -- ni
 * qué campo del payload usar para buscarlo (email? un "external_reference"
 * que dLocal Go permita configurar? un customer id que haya que loguear la
 * primera vez para poder correlacionar después?).
 *
 * Adivinar esa correlación sería exactamente la "verificación insegura"
 * que no hay que inventar -- podría activar PRO en la cuenta equivocada.
 * Por eso esta función, tal cual está, SOLO verifica un secret compartido
 * y loguea el payload crudo (visible en los logs de Supabase) -- no
 * escribe nada en `profiles`. Ver el bloque TODO más abajo para lo que
 * falta, y el mensaje final de la tarea que agregó esto para el resumen
 * exacto de qué información hace falta pedirle a dLocal.
 *
 * ============================================================
 * SEGURIDAD MIENTRAS TANTO
 * ============================================================
 * - `DLOCAL_WEBHOOK_SECRET` (secret de proyecto, no configurado todavía):
 *   se exige como query param (?secret=...) o header (x-webhook-secret).
 *   Es una protección mínima genérica -- no el mecanismo de firma real de
 *   dLocal (HMAC/firma de payload), que hay que implementar según su
 *   documentación una vez se tenga. Sin el secret configurado, esta
 *   función rechaza TODO (falla cerrado, nunca abierto).
 * - Nunca hay un botón "ya pagué -> activar PRO" en la app: la única
 *   forma de que `profiles.plan` pase a 'pro' es desde acá (o cualquier
 *   otro camino server-side/service_role), nunca desde el cliente -- ver
 *   la migración que agregó plan/pro_* (sin GRANT UPDATE para
 *   `authenticated` en esas columnas).
 */
import { corsHeaders } from '../_shared/cors.ts';

// SUPABASE_URL/SERVICE_ROLE_KEY se van a necesitar acá apenas el paso 3 del
// TODO de abajo se complete (createClient(...) para escribir profiles) --
// no se instancia un cliente todavía porque esta función no escribe nada.
const WEBHOOK_SECRET = Deno.env.get('DLOCAL_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Falla cerrado: sin secret configurado, nadie pasa -- nunca "abierto
  // por accidente" mientras se termina de configurar.
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
  if (!WEBHOOK_SECRET || providedSecret !== WEBHOOK_SECRET) {
    return jsonResponse({ error: 'No autorizado' }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Payload inválido' }, 400);
  }

  // Log estructurado -- mismo patrón que el resto de las Edge Functions
  // (ver gemini.ts/challengeResolution.ts). Esto es lo único que hace esta
  // función por ahora: dejar constancia de qué manda dLocal de verdad,
  // para poder terminar la integración con el payload real en vez de uno
  // adivinado.
  console.log(JSON.stringify({ src: 'dlocal-webhook', event: 'payload_received', payload }));

  // ============================================================
  // TODO -- completar cuando se confirme con dLocal Go:
  //
  // 1. Verificación de firma real del payload (reemplaza/complementa el
  //    secret compartido de arriba) -- método exacto según su documentación.
  // 2. Cómo identificar al usuario de AURAXP a partir del payload --
  //    necesita un external_reference/metadata que dLocal Go permita
  //    adjuntar al crear el checkout, o el email del pagador para cruzar
  //    contra auth.users.
  // 3. Con eso resuelto, algo en la forma de:
  //
  //    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  //    await admin.from('profiles').update({
  //      plan: 'pro',
  //      pro_status: 'active',
  //      pro_started_at: new Date().toISOString(),
  //      pro_provider: 'dlocal',
  //      pro_subscription_id: payload.subscription_id, // campo real, TBD
  //    }).eq('id', resolvedUserId);
  //
  //    Y el camino simétrico para cancelación/pago fallido -> plan: 'free',
  //    pro_status: 'canceled' | 'past_due'.
  // ============================================================

  return jsonResponse({ ok: true, received: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
