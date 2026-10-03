/**
 * livekit-token -- único emisor de tokens de LiveKit. El cliente NUNCA ve
 * LIVEKIT_API_SECRET (ver docs/aura-live.md, sección Seguridad) -- esta
 * función decide el rol real (host vs viewer) mirando `live_rooms` en la
 * base, nunca confiando en un campo `role` que mande el cliente (sección
 * 7 del pedido: "El cliente JAMÁS puede mandar role: host y conseguir
 * privilegios de host simplemente porque lo pidió").
 *
 * AUDITORÍA GPT hallazgo #7: la primera versión de esta función firmaba
 * el JWT a mano (Web Crypto, HMAC-SHA256) para evitar depender de
 * `livekit-server-sdk` sin poder probarlo. Se investigó de nuevo con
 * evidencia real (no solo documentación) antes de decidir:
 *   1. LiveKit documenta oficialmente que `livekit-server-sdk` v2 corre
 *      en Node, Deno Y Bun.
 *   2. El paquete v2.19.1 (instalado y leído directamente desde
 *      node_modules en este sandbox) depende únicamente de
 *      `@bufbuild/protobuf`, `@livekit/protocol` y `jose` -- CERO
 *      dependencias nativas de Node (`grep` sobre el bundle completo no
 *      encontró ningún `require('fs'|'net'|'tls'|'dns'|...)`), y `jose`
 *      es la librería JWT basada en Web Crypto que la propia LiveKit
 *      adoptó en v2 específicamente para soportar runtimes edge.
 *   3. Supabase Edge Functions ya usa el especificador `npm:` en este
 *      mismo repo (ver supabase/functions/send-push/index.ts, `npm:web-
 *      push@3`), así que no es un patrón nuevo sin precedente acá.
 *   4. Se corrió `AccessToken.toJwt()` y `WebhookReceiver.receive()` de
 *      verdad (Node, mismo código JS que ejecutaría Deno) con un payload
 *      firmado a mano siguiendo el esquema público de LiveKit Webhooks:
 *      el token se generó correctamente y la verificación aceptó un
 *      body válido y RECHAZÓ uno alterado (`sha256 checksum of body does
 *      not match`).
 * Con esa evidencia, se reemplaza la implementación manual por el SDK
 * oficial -- sigue exactamente su API documentada (AccessToken +
 * addGrant + toJwt), nunca se reinventa el protocolo. Lo que SIGUE sin
 * poder confirmarse desde este sandbox (sin proyecto Supabase ni LiveKit
 * real): que `npm:livekit-server-sdk` resuelva igual dentro del runtime
 * Edge Function ya desplegado (Deno Deploy), y que un servidor LiveKit
 * real acepte un token emitido así. Ningún punto de esto se declara
 * "probado contra LiveKit real" -- ver el reporte de esta tarea.
 *
 * Identidad SIEMPRE opaca (sección 7): `user:<uuid>` para autenticados,
 * `guest:<visitor_id>` para invitados -- nunca email/username/nombre real
 * en el room name ni en el participant identity. `visitor_id` ya es un
 * string opaco generado client-side (ver campaignService.ts), el mismo
 * que ya usa Chat V1/V2 para identidad de invitado -- no se inventa un
 * segundo identificador.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken, type VideoGrant } from 'npm:livekit-server-sdk@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

// 6 horas -- generoso para un show largo (sección 3: "pueden durar...
// varias horas"), pero cualquier reconexión real vuelve a pedir un token
// fresco acá (ver liveMediaService.web.ts), así que esto solo acota la
// conexión INICIAL ininterrumpida, no la duración total de un LIVE.
const TOKEN_TTL_SECONDS = 6 * 60 * 60;

/**
 * Access Token de LiveKit -- SDK oficial (ver nota arriba). `addGrant`
 * recibe exactamente la forma `VideoGrant` que exporta el propio
 * paquete, nunca un tipo inventado acá.
 */
async function createLiveKitToken(identity: string, grant: VideoGrant): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: TOKEN_TTL_SECONDS });
  at.addGrant(grant);
  return at.toJwt();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    // Config pendiente (sección 28) -- nunca un 500 críptico. El cliente
    // (liveMediaService.web.ts) debe tratar esto como "LIVE no disponible
    // todavía", nunca intentar conectar con un token vacío.
    return jsonResponse({ error: 'livekit_not_configured' }, 503);
  }

  try {
    const body = (await req.json()) as { roomId?: string; guestId?: string };
    const roomId = body.roomId;
    if (!roomId) return jsonResponse({ error: 'roomId requerido' }, 400);

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();

    let identity: string;
    if (user) {
      identity = `user:${user.id}`;
    } else {
      const guestId = body.guestId;
      if (!guestId || guestId.length < 8 || guestId.length > 200) {
        return jsonResponse({ error: 'guestId inválido' }, 400);
      }
      identity = `guest:${guestId}`;
    }

    // service_role: la decisión de rol/estado de la sala es autoridad del
    // servidor, nunca de RLS del lado del cliente (mismo criterio que
    // process-scan usando `admin` para todo lo que de verdad importa).
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: room, error: roomErr } = await admin
      .from('live_rooms')
      .select('id, status, host_user_id, livekit_room_name')
      .eq('id', roomId)
      .maybeSingle();

    if (roomErr || !room) return jsonResponse({ error: 'room_not_found' }, 404);
    if (room.status === 'cancelled') return jsonResponse({ error: 'room_cancelled' }, 410);

    const isHost = Boolean(user) && user!.id === room.host_user_id;

    if (isHost) {
      // El host necesita un token tanto en 'preparing' (preview antes de
      // transmitir) como en 'live' -- nunca en 'ended'/'cancelled'.
      if (room.status === 'ended') return jsonResponse({ error: 'room_ended' }, 410);
    } else {
      // Un espectador (autenticado o invitado) solo puede unirse cuando
      // la sala está REALMENTE en vivo -- nada que ver todavía en
      // 'preparing', nada que ver ya en 'ended'/'cancelled'.
      if (room.status !== 'live') {
        return jsonResponse({ error: room.status === 'preparing' ? 'not_live_yet' : 'room_ended' }, 409);
      }
    }

    const grant: VideoGrant = {
      room: room.livekit_room_name,
      roomJoin: true,
      canPublish: isHost,
      canSubscribe: true,
      canPublishData: false,
    };

    const token = await createLiveKitToken(identity, grant);

    return jsonResponse({
      token,
      identity,
      role: isHost ? 'host' : 'viewer',
      livekitRoomName: room.livekit_room_name,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (e) {
    console.error(JSON.stringify({ src: 'livekit-token', event: 'unexpected_error', message: String(e) }));
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
