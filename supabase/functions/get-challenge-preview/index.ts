/**
 * get-challenge-preview — pública, sin JWT.
 *
 * Alimenta tanto la landing web del Challenge como la pantalla nativa
 * al abrir un link. Usa service_role internamente y devuelve
 * ÚNICAMENTE los campos necesarios para el preview — nunca el video,
 * nunca gemini_raw, nunca stats detallados de otro usuario.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Acepta el token por query param (?token=...) o por body JSON
    // ({ token: ... }) — cubre tanto un fetch directo desde la landing
    // web como supabase.functions.invoke() desde el cliente RN.
    const url = new URL(req.url);
    let shareToken = url.searchParams.get('token');
    if (!shareToken && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      shareToken = body?.token ?? null;
    }

    if (!shareToken) return jsonResponse({ error: 'token requerido' }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: challenge } = await admin
      .from('challenges')
      .select('source_scan_id, from_user_id, status, expires_at')
      .eq('share_token', shareToken)
      .single();

    if (!challenge) return jsonResponse({ error: 'Challenge no encontrado' }, 404);

    // Lazy expiration: si nadie lo aceptó y ya pasó expires_at, se reporta
    // como expirado acá mismo (sin depender de un cron) -- best-effort,
    // escribirlo en la fila es solo higiene, no afecta la respuesta.
    let status = challenge.status as string;
    if (status === 'pending' && challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
      status = 'expired';
      admin
        .from('challenges')
        .update({ status: 'expired' })
        .eq('share_token', shareToken)
        .eq('status', 'pending')
        .then(() => {}, () => {});
    }

    const [{ data: scan }, { data: profile }] = await Promise.all([
      admin
        .from('scans')
        .select('aura_score, verdict_tag')
        .eq('id', challenge.source_scan_id)
        .single(),
      admin
        .from('public_profiles')
        .select('username, avatar_emoji')
        .eq('id', challenge.from_user_id)
        .single(),
    ]);

    if (!scan || !profile) return jsonResponse({ error: 'Challenge incompleto' }, 404);

    return jsonResponse({
      fromUsername: profile.username,
      fromAvatarEmoji: profile.avatar_emoji,
      auraScore: scan.aura_score,
      verdictTag: scan.verdict_tag,
      status,
    });
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
