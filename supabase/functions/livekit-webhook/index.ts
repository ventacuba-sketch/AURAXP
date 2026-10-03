/**
 * livekit-webhook -- reconciliación server-side (sección 35 del pedido):
 * "no confíes solamente en que el host cliente llame end_live_room". Si
 * el host cierra la pestaña, pierde internet o el teléfono se apaga, la
 * sala real en LiveKit termina igual -- esto es lo que entera a Supabase
 * de ese hecho sin depender de ningún cliente.
 *
 * AUDITORÍA GPT hallazgo #7: se reemplazó la verificación de firma hecha
 * a mano por `WebhookReceiver` del SDK oficial (`livekit-server-sdk`),
 * con la misma justificación documentada en livekit-token/index.ts
 * (Deno/Bun soportados oficialmente, cero dependencias nativas de Node
 * en el paquete real instalado y leído en este sandbox, patrón `npm:`
 * ya usado en este repo). Se corrió `WebhookReceiver.receive()` de
 * verdad contra un payload firmado siguiendo el esquema público de
 * LiveKit Webhooks: aceptó el body válido y RECHAZÓ uno alterado
 * ("sha256 checksum of body does not match"). Lo que sigue sin poder
 * confirmarse desde acá: que un servidor LiveKit real firme exactamente
 * así en producción, y que `npm:livekit-server-sdk` resuelva igual
 * dentro del runtime Edge Function ya desplegado -- ver el reporte de
 * esta tarea. Diseño fail-closed sin cambios: cualquier fallo de
 * verificación devuelve 401 y NUNCA toca `live_rooms`.
 *
 * Idempotencia (auditoría adicional: "webhook idempotente"): LiveKit
 * reintenta entregas que no confirman 200 a tiempo. `WebhookEvent.id`
 * (del SDK oficial) es un uuid único por entrega -- se graba en
 * `live_webhook_events.livekit_event_id` con un índice único parcial
 * (ver la migración), así que un reintento exacto no vuelve a reconciliar
 * ni a auditar dos veces. `update ... where status <> 'ended'` sobre
 * `live_rooms` ya era idempotente por sí solo; esto además evita filas
 * de auditoría duplicadas.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { WebhookReceiver } from 'npm:livekit-server-sdk@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    // Config pendiente -- nunca procesar un webhook sin poder verificar
    // su firma (mismo criterio fail-closed que livekit-token).
    return jsonResponse({ error: 'livekit_not_configured' }, 503);
  }

  const rawBody = await req.text();
  const authHeader = req.headers.get('Authorization') ?? undefined;

  const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  let event: Awaited<ReturnType<typeof receiver.receive>>;
  try {
    event = await receiver.receive(rawBody, authHeader);
  } catch (e) {
    console.warn(JSON.stringify({ src: 'livekit-webhook', event: 'signature_rejected', message: String(e) }));
    return jsonResponse({ error: 'invalid_signature' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Auditoría cruda primero, siempre -- incluso de eventos que no
  // reconciliamos todavía (participant_joined/left, track_published,
  // etc.) -- preparado para analítica/depuración futura sin tener que
  // volver a tocar este endpoint. `onConflict` sobre el id único de
  // LiveKit hace que un reintento exacto no duplique la fila de
  // auditoría (ver nota de idempotencia arriba).
  const { data: inserted } = await admin
    .from('live_webhook_events')
    .upsert(
      { livekit_event_id: event.id || null, event_type: event.event, livekit_room_name: event.room?.name ?? null, raw: event.toJson() },
      { onConflict: 'livekit_event_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  try {
    // room_finished es el evento que de verdad nos importa para
    // reconciliar: LiveKit cerró la sala (nadie publicando, o el
    // servidor la expiró) sin que el host necesariamente haya llamado
    // end_live_room. Idempotente -- si ya estaba 'ended', este update
    // simplemente no afecta ninguna fila.
    if (event.event === 'room_finished' && event.room?.name) {
      await admin
        .from('live_rooms')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('livekit_room_name', event.room.name)
        .neq('status', 'ended');
    }
    if (inserted) {
      await admin.from('live_webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', inserted.id);
    }
  } catch (e) {
    console.error(JSON.stringify({ src: 'livekit-webhook', event: 'reconcile_failed', message: String(e) }));
  }

  return jsonResponse({ ok: true });
});
