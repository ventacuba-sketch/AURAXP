/**
 * livekit-token -- único emisor de tokens de LiveKit. El cliente NUNCA ve
 * LIVEKIT_API_SECRET (ver docs/aura-live.md, sección Seguridad) -- esta
 * función decide el rol real (host vs viewer) mirando `live_rooms` en la
 * base, nunca confiando en un campo `role` que mande el cliente (sección
 * 7 del pedido: "El cliente JAMÁS puede mandar role: host y conseguir
 * privilegios de host simplemente porque lo pidió").
 *
 * Por qué el JWT se arma a mano acá (Web Crypto, HMAC-SHA256) en vez de
 * usar `livekit-server-sdk`: ese paquete no está probado contra el
 * runtime real de Supabase Edge Functions desde este entorno (sin acceso
 * a un proyecto Supabase real para desplegar y confirmar compatibilidad
 * Deno/npm, ver sección 34 del pedido) -- Web Crypto, en cambio, es una
 * API nativa de Deno, cero dependencia npm, cero riesgo de
 * incompatibilidad de runtime para la ruta más crítica de seguridad de
 * todo AURA LIVE. El formato del token (claims `video.*`) sigue el
 * esquema público y estable de LiveKit Access Tokens -- documentado acá
 * mismo, nunca verificado contra un servidor LiveKit real desde este
 * sandbox (sin credenciales, ver el reporte de esta tarea).
 *
 * Identidad SIEMPRE opaca (sección 7): `user:<uuid>` para autenticados,
 * `guest:<visitor_id>` para invitados -- nunca email/username/nombre real
 * en el room name ni en el participant identity. `visitor_id` ya es un
 * string opaco generado client-side (ver campaignService.ts), el mismo
 * que ya usa Chat V1/V2 para identidad de invitado -- no se inventa un
 * segundo identificador.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
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

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const keyBytes = new TextEncoder().encode(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

interface VideoGrant {
  room: string;
  roomJoin: true;
  canPublish: boolean;
  canSubscribe: true;
  canPublishData: boolean;
}

/**
 * Access Token de LiveKit -- JWT HS256 firmado con LIVEKIT_API_SECRET.
 * Forma de claims documentada públicamente por LiveKit (AccessToken):
 * iss = API key, sub = identidad del participante, video = el grant real
 * (lo único que de verdad importa para permisos -- roomJoin/canPublish/
 * canSubscribe/canPublishData). Nunca verificado contra un servidor
 * LiveKit real desde este sandbox -- ver limitación en el reporte final.
 */
async function createLiveKitToken(identity: string, grant: VideoGrant): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: LIVEKIT_API_KEY,
    sub: identity,
    jti: identity,
    iat: now,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    video: grant,
  };
  const headerB64 = base64urlJson(header);
  const payloadB64 = base64urlJson(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSha256(LIVEKIT_API_SECRET, signingInput);
  return `${signingInput}.${base64url(signature)}`;
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
