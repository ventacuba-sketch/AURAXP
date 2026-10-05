import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:soporte@auravs.app';
const WEB_ORIGIN = 'https://auravs.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function logSendPush(event: string, data: Record<string, unknown> = {}) { console.log(JSON.stringify({ src: 'send-push', event, ...data })); }
function endpointHost(endpoint: string) { try { return new URL(endpoint).host; } catch { return null; } }

type Kind = 'challenge_received'|'challenge_accepted'|'challenge_completed'|'challenge_rejected'|'referral_activated'|'new_follower'|'gift_received'|'chat_private_request'|'chat_private_request_accepted'|'chat_private_message'|'live_started';
interface NotificationRow { id:string; user_id:string; kind:Kind; challenge_share_token:string|null; rival_user_id:string|null; result:'won'|'lost'|'tie'|null; private_conversation_id:string|null; live_room_id:string|null; }

function buildMessage(n: NotificationRow, rivalUsername: string, liveTitle?: string|null): {title:string;body:string} {
  switch (n.kind) {
    case 'challenge_received': return { title:'AURA VS ⚔️', body:`@${rivalUsername} te desafió` };
    case 'challenge_accepted': return { title:'AURA VS ⚔️', body:`@${rivalUsername} aceptó tu desafío` };
    case 'challenge_rejected': return { title:'AURA VS', body:`@${rivalUsername} rechazó tu desafío` };
    case 'challenge_completed':
      if (n.result === 'won') return { title:'🏆 Ganaste la batalla', body:`Le ganaste a @${rivalUsername}` };
      if (n.result === 'lost') return { title:'💀 Perdiste la batalla', body:`@${rivalUsername} te ganó` };
      return { title:'🤝 Empate', body:`Empataste con @${rivalUsername}` };
    case 'referral_activated': return { title:'🎉 Coins ganados', body:`@${rivalUsername} hizo su primer Scan -- ganaste 5.000 Coins` };
    case 'new_follower': return { title:'AURA VS', body:`@${rivalUsername} empezó a seguirte` };
    case 'gift_received': return { title:'🎁 Recibiste un regalo', body:`@${rivalUsername} te mandó un regalo` };
    case 'chat_private_request': return { title:'💬 Sala del Aura', body:`@${rivalUsername} quiere iniciar un chat privado contigo` };
    case 'chat_private_request_accepted': return { title:'✅ Chat privado aceptado', body:`@${rivalUsername} aceptó tu solicitud` };
    case 'chat_private_message': return { title:'💬 Nuevo mensaje privado', body:`@${rivalUsername} te envió un mensaje` };
    case 'live_started': return { title:`🔴 @${rivalUsername} inició un AURA LIVE`, body:liveTitle?.trim() || 'Toca para entrar al LIVE' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if ((req.headers.get('Authorization') ?? '') !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return jsonResponse({ error:'No autorizado' }, 401);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return jsonResponse({ ok:false, reason:'vapid_not_configured' });
  try {
    const { notification_id } = await req.json() as { notification_id?:string };
    if (!notification_id) return jsonResponse({ error:'notification_id requerido' }, 400);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: notification } = await admin.from('notifications').select('id,user_id,kind,challenge_share_token,rival_user_id,result,private_conversation_id,live_room_id').eq('id', notification_id).maybeSingle<NotificationRow>();
    if (!notification) return jsonResponse({ ok:false, reason:'notification_not_found' });

    const [{ data:rivalProfile }, { data:subscriptions }, { data:liveRoom }] = await Promise.all([
      notification.rival_user_id ? admin.from('profiles').select('username').eq('id', notification.rival_user_id).maybeSingle() : Promise.resolve({ data:null }),
      admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', notification.user_id).is('revoked_at', null),
      notification.live_room_id ? admin.from('live_rooms').select('slug,title').eq('id', notification.live_room_id).maybeSingle() : Promise.resolve({ data:null }),
    ]);
    if (!subscriptions || subscriptions.length === 0) return jsonResponse({ ok:true, sent:0, reason:'no_subscriptions' });

    const { title, body } = buildMessage(notification, rivalProfile?.username ?? 'alguien', liveRoom?.title);
    const url = notification.live_room_id && liveRoom?.slug ? `${WEB_ORIGIN}/live/${liveRoom.slug}` : notification.challenge_share_token ? `${WEB_ORIGIN}/c/${notification.challenge_share_token}` : notification.kind.startsWith('chat_private_') ? `${WEB_ORIGIN}/chat` : WEB_ORIGIN;
    const payload = JSON.stringify({ title, body, url, kind:notification.kind });
    let sent=0, revoked=0;
    await Promise.all(subscriptions.map(async (sub) => {
      const host=endpointHost(sub.endpoint);
      try {
        const result = await webpush.sendNotification({ endpoint:sub.endpoint, keys:{ p256dh:sub.p256dh, auth:sub.auth } }, payload) as {statusCode?:number}|undefined;
        sent++; logSendPush('send_ok',{ notification_id, subscriptionId:sub.id, provider:host, statusCode:result?.statusCode ?? null });
      } catch (err) {
        const status=(err as {statusCode?:number})?.statusCode ?? null;
        if (status===404 || status===410) { await admin.from('push_subscriptions').update({ revoked_at:new Date().toISOString() }).eq('id',sub.id); revoked++; }
        else logSendPush('send_failed',{ notification_id, subscriptionId:sub.id, provider:host, statusCode:status, message:err instanceof Error ? err.message : String(err) });
      }
    }));
    return jsonResponse({ ok:true, sent, revoked, total:subscriptions.length });
  } catch (e) {
    console.error(JSON.stringify({ src:'send-push', event:'unexpected_error', message:String(e) }));
    return jsonResponse({ ok:false, reason:'internal_error' });
  }
});

function jsonResponse(body: unknown, status=200): Response { return new Response(JSON.stringify(body), { status, headers:{ ...corsHeaders, 'Content-Type':'application/json' } }); }
