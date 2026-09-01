/**
 * send-push — Web Push real (A-D del bloque pre-lanzamiento). Llamada
 * SOLO por el trigger `notifications_push_trigger` (ver la migración
 * 20260904000000, vía pg_net) apenas se inserta una fila real en
 * `notifications` -- nunca desde el cliente directamente. Best-effort de
 * punta a punta: cualquier error acá queda en los logs de esta función,
 * nunca revierte nada (la notification in-app ya existe de todos modos,
 * el push es un plus, no la fuente de verdad).
 *
 * Auth: el caller pasa `Authorization: Bearer <service_role_key>` (el
 * mismo valor guardado en Vault, ver la migración) -- se compara byte a
 * byte contra el env var real de esta función. No es la verificación JWT
 * de la plataforma (que también aplicaría, un service_role key es un JWT
 * válido) sino una segunda capa explícita, mismo criterio "fail cerrado"
 * que ya usa dlocal-webhook.
 *
 * Deep link: SIEMPRE `/c/<challenge_share_token>` -- ChallengeLandingScreen
 * ahora entra directo al Challenge real para un participante autenticado
 * cuando el estado es 'accepted'/'completed' (ver ese archivo), así que
 * un solo path cubre challenge_received/accepted/completed/rejected sin
 * inventar rutas nuevas ni tocar el linking config existente.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
// mailto: de contacto real -- lo exige el estándar VAPID (el push service
// del navegador puede usarlo para avisar al remitente de un problema).
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:soporte@auravs.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const WEB_ORIGIN = 'https://auravs.app';

interface NotificationRow {
  id: string;
  user_id: string;
  kind: 'challenge_received' | 'challenge_accepted' | 'challenge_completed' | 'challenge_rejected';
  challenge_share_token: string | null;
  rival_user_id: string | null;
  result: 'won' | 'lost' | 'tie' | null;
}

function buildMessage(n: NotificationRow, rivalUsername: string): { title: string; body: string } {
  switch (n.kind) {
    case 'challenge_received':
      return { title: 'AURAXP ⚔️', body: `@${rivalUsername} te desafió` };
    case 'challenge_accepted':
      return { title: 'AURAXP ⚔️', body: `@${rivalUsername} aceptó tu desafío` };
    case 'challenge_rejected':
      return { title: 'AURAXP', body: `@${rivalUsername} rechazó tu desafío` };
    case 'challenge_completed':
      if (n.result === 'won') return { title: '🏆 Ganaste la batalla', body: `Le ganaste a @${rivalUsername}` };
      if (n.result === 'lost') return { title: '💀 Perdiste la batalla', body: `@${rivalUsername} te ganó` };
      return { title: '🤝 Empate', body: `Empataste con @${rivalUsername}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return jsonResponse({ error: 'No autorizado' }, 401);
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // Vault ya está configurado (si no, el trigger nunca llega hasta acá)
    // pero faltan las claves VAPID como secret de esta función -- paso
    // manual pendiente (ver reporte), no un error real: nunca hay nada
    // roto del lado del Challenge, solo el push no puede enviarse todavía.
    console.log(JSON.stringify({ src: 'send-push', event: 'vapid_not_configured' }));
    return jsonResponse({ ok: false, reason: 'vapid_not_configured' });
  }

  try {
    const { notification_id } = (await req.json()) as { notification_id?: string };
    if (!notification_id) return jsonResponse({ error: 'notification_id requerido' }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: notification } = await admin
      .from('notifications')
      .select('id, user_id, kind, challenge_share_token, rival_user_id, result')
      .eq('id', notification_id)
      .maybeSingle<NotificationRow>();

    if (!notification) return jsonResponse({ ok: false, reason: 'notification_not_found' });

    const [{ data: rivalProfile }, { data: subscriptions }] = await Promise.all([
      notification.rival_user_id
        ? admin.from('profiles').select('username').eq('id', notification.rival_user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', notification.user_id)
        .is('revoked_at', null),
    ]);

    if (!subscriptions || subscriptions.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no_subscriptions' });
    }

    const { title, body } = buildMessage(notification, rivalProfile?.username ?? 'alguien');
    const url = notification.challenge_share_token ? `${WEB_ORIGIN}/c/${notification.challenge_share_token}` : WEB_ORIGIN;
    const payload = JSON.stringify({ title, body, url, kind: notification.kind });

    let sent = 0;
    let revoked = 0;
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent += 1;
        } catch (err) {
          // 404/410: el navegador ya no reconoce ese endpoint (usuario
          // desinstaló/revocó el permiso desde el OS/browser) -- marcar
          // revoked_at para que send-push deje de intentarle, sin borrar
          // la fila (ver comentario en la migración). Cualquier OTRO error
          // (red, 5xx del push service) solo se loguea -- una falla
          // transitoria no debe apagar una suscripción real.
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').update({ revoked_at: new Date().toISOString() }).eq('id', sub.id);
            revoked += 1;
          } else {
            console.log(JSON.stringify({ src: 'send-push', event: 'send_failed', subscriptionId: sub.id, status, message: String(err) }));
          }
        }
      }),
    );

    return jsonResponse({ ok: true, sent, revoked, total: subscriptions.length });
  } catch (e) {
    console.error(JSON.stringify({ src: 'send-push', event: 'unexpected_error', message: String(e) }));
    // 200, no 500: esto lo llama pg_net de forma asíncrona -- no hay nadie
    // esperando un código de error que pueda actuar sobre él, y el punto
    // entero es que esto NUNCA debe verse como un fallo que valga la pena
    // reintentar agresivamente ni escalar.
    return jsonResponse({ ok: false, reason: 'internal_error' });
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
