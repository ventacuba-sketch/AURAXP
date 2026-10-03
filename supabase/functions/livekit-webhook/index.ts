/**
 * livekit-webhook -- reconciliación server-side (sección 35 del pedido):
 * "no confíes solamente en que el host cliente llame end_live_room". Si
 * el host cierra la pestaña, pierde internet o el teléfono se apaga, la
 * sala real en LiveKit termina igual -- esto es lo que entera a Supabase
 * de ese hecho sin depender de ningún cliente.
 *
 * LIMITACIÓN HONESTA (declarada en el reporte de esta tarea, no oculta
 * acá): la verificación de firma de abajo es una reconstrucción de buena
 * fe del esquema de autenticación de LiveKit Webhooks (JWT HS256 firmado
 * con el API secret, claim `sha256` = hash del body crudo en base64) a
 * partir de conocimiento previo del formato -- NUNCA se probó contra una
 * entrega real de LiveKit desde este entorno (sin proyecto/credenciales
 * LiveKit disponibles). Antes de depender de esto en producción: generar
 * un evento real desde el dashboard de LiveKit (o `lk` CLI) apuntando a
 * esta función desplegada y confirmar que la firma verifica. Mientras
 * tanto, el diseño es fail-closed -- cualquier fallo de verificación
 * devuelve 401 y NUNCA toca `live_rooms`, así que un webhook roto no
 * puede ni dañar datos ni aceptar un POST arbitrario como si fuera real.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256Verify(key: string, data: string, expectedSig: Uint8Array): Promise<boolean> {
  const keyBytes = new TextEncoder().encode(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', cryptoKey, expectedSig, new TextEncoder().encode(data));
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary);
}

interface LiveKitWebhookPayload {
  event: string;
  room?: { name?: string; sid?: string };
  participant?: { identity?: string };
}

/**
 * Verifica el JWT del header Authorization: firma HS256 con
 * LIVEKIT_API_SECRET, `iss` debe ser LIVEKIT_API_KEY, y el claim
 * `sha256` debe coincidir con el hash SHA-256 (base64) del body crudo
 * EXACTO recibido -- esto es lo que evita que cualquiera pueda mandar un
 * POST inventado y que se procese como un evento real (sección 35:
 * "no aceptar POST arbitrario como evento LiveKit válido").
 */
async function verifyLiveKitWebhook(authHeader: string, rawBody: string): Promise<boolean> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return false;
  const parts = authHeader.replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  const signature = base64urlDecode(sigB64);
  const verified = await hmacSha256Verify(LIVEKIT_API_SECRET, `${headerB64}.${payloadB64}`, signature);
  if (!verified) return false;

  let payload: { iss?: string; sha256?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return false;
  }

  if (payload.iss !== LIVEKIT_API_KEY) return false;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;

  const bodyHash = await sha256Base64(rawBody);
  return payload.sha256 === bodyHash;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const rawBody = await req.text();
  const authHeader = req.headers.get('Authorization') ?? '';

  const valid = await verifyLiveKitWebhook(authHeader, rawBody);
  if (!valid) {
    console.warn(JSON.stringify({ src: 'livekit-webhook', event: 'signature_rejected' }));
    return jsonResponse({ error: 'invalid_signature' }, 401);
  }

  let payload: LiveKitWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Auditoría cruda primero, siempre -- incluso de eventos que no
  // reconciliamos todavía (participant_joined/left, track_published,
  // etc.) -- preparado para analítica/depuración futura sin tener que
  // volver a tocar este endpoint.
  const { data: inserted } = await admin
    .from('live_webhook_events')
    .insert({ event_type: payload.event, livekit_room_name: payload.room?.name ?? null, raw: payload })
    .select('id')
    .maybeSingle();

  try {
    // room_finished es el evento que de verdad nos importa para
    // reconciliar: LiveKit cerró la sala (nadie publicando, o el
    // servidor la expiró) sin que el host necesariamente haya llamado
    // end_live_room. Idempotente -- si ya estaba 'ended', este update
    // simplemente no afecta ninguna fila.
    if (payload.event === 'room_finished' && payload.room?.name) {
      await admin
        .from('live_rooms')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('livekit_room_name', payload.room.name)
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
