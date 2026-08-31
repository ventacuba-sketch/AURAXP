/**
 * get-replay-url — signed URL para reproducir el video de un Scan, sea
 * propio o el del rival en un Challenge ya completado.
 *
 * ============================================================
 * POR QUÉ EXISTE ESTO (bug real, probado con dos cuentas reales)
 * ============================================================
 * Antes, el cliente llamaba directo a
 * `supabase.storage.from('scans').createSignedUrl(...)` para CUALQUIER
 * replay -- el propio y el del rival -- confiando en que las RLS
 * policies de storage.objects resolvieran bien el acceso. Probado
 * end-to-end: el replay PROPIO funciona (scans_select_completed_
 * challenge_rival y scans_bucket_select_own son policies de una sola
 * tabla, sin JOIN) pero el replay del RIVAL no -- y sí se ve
 * correctamente su puntaje/stats (esos vienen de
 * scans_select_completed_challenge_rival, que tampoco tiene JOIN). La
 * única policy que involucra un JOIN de dos saltos sobre una tabla del
 * sistema (storage.objects -> scans -> challenges) es
 * scans_bucket_select_completed_challenge_rival -- exactamente la que
 * hace falta para el video del rival. No se puede ejecutar SQL contra el
 * proyecto real desde este sandbox para confirmar la causa exacta ahí
 * dentro, así que en vez de seguir adivinando sobre una cadena de RLS de
 * dos saltos sobre una tabla del sistema, esta función mueve la
 * autorización a código explícito (un solo lugar, auditable, logueado) y
 * firma la URL con service_role -- deja de depender de que esa cadena de
 * policies se resuelva bien.
 *
 * El bucket sigue privado -- esto NO lo hace público. Esta función es la
 * ÚNICA puerta nueva: exige JWT real, y solo autoriza dos casos:
 * 1. sos el dueño del scan;
 * 2. sos participante (from_user_id u opponent_user_id) de un Challenge
 *    cuyo status YA es 'completed' y ese scan es source_scan_id o
 *    target_scan_id de ese Challenge -- antes de completarse, sigue sin
 *    poder verse (mismo comportamiento que ya tenía scans_select_
 *    completed_challenge_rival).
 * Cualquier otro caso: 403, nunca una URL.
 *
 * ============================================================
 * SEGUNDO BUG REAL, encontrado auditando esto de nuevo (no se asumió que
 * el fix de arriba ya alcanzaba, se re-verificó end-to-end): el chequeo
 * de (2) usaba `.maybeSingle()`, que exige que la query devuelva como
 * mucho UNA fila. Pero un scan puede ser source_scan_id de más de un
 * Challenge 'completed' -- exactamente lo que pasa apenas se usa REVANCHA
 * sobre un scan que ya había sido el de un duelo anterior. Con 2+ filas,
 * `.maybeSingle()` devuelve un error (que este código ni siquiera
 * chequeaba) y `data: null`, así que el rival legítimo caía en 403. Fix:
 * traer TODAS las filas que referencian el scan y autorizar si el usuario
 * es participante de CUALQUIERA de ellas (ver más abajo).
 * ============================================================
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Mismo TTL que ya usaba el cliente para el replay propio (scanService.ts).
const SIGNED_URL_TTL_SECONDS = 60 * 60;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = await req.json().catch(() => ({}));
    const scanId = body?.scanId;
    if (!scanId) return jsonResponse({ error: 'scanId requerido' }, 400);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: 'No autenticado' }, 401);

    // service_role -- ignora RLS a propósito: la autorización real pasa
    // acá abajo, en código explícito, no en policies.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: scan, error: scanErr } = await admin
      .from('scans')
      .select('id, user_id, video_path')
      .eq('id', scanId)
      .single();

    if (scanErr || !scan || !scan.video_path) {
      console.log(
        JSON.stringify({
          src: 'get-replay-url',
          event: 'scan_not_found',
          requester_user_id: user.id,
          requested_scan_id: scanId,
        }),
      );
      return jsonResponse({ error: 'Scan no encontrado' }, 404);
    }

    let authorized = scan.user_id === user.id;
    let matchedChallengeId: string | null = null;

    if (!authorized) {
      // BUG REAL encontrado auditando esto (no se asumió que ya andaba):
      // esto usaba `.maybeSingle()`, que EXIGE que la query devuelva como
      // mucho una fila -- pero un scan puede perfectamente ser
      // source_scan_id de MÁS DE UN Challenge 'completed' (exactamente lo
      // que pasa apenas se usa REVANCHA sobre un scan que ya era el
      // ganador/perdedor de un duelo anterior: el mismo scan queda como
      // source_scan_id de dos filas de `challenges`). Con más de una fila,
      // `.maybeSingle()` devuelve un error (PGRST116) y `data: null` --
      // ese error se descartaba sin chequear, así que `challenge` quedaba
      // `null` y el rival legítimo recibía 403. Fix: traer TODAS las filas
      // que referencian este scan como completadas y autorizar si el
      // usuario es participante de CUALQUIERA de ellas.
      const { data: challenges, error: challengeErr } = await admin
        .from('challenges')
        .select('id, from_user_id, opponent_user_id, status')
        .or(`source_scan_id.eq.${scanId},target_scan_id.eq.${scanId}`)
        .eq('status', 'completed');

      if (challengeErr) {
        console.log(
          JSON.stringify({
            src: 'get-replay-url',
            event: 'challenge_lookup_error',
            requester_user_id: user.id,
            requested_scan_id: scanId,
            error: String(challengeErr),
          }),
        );
      }

      const matched = (challenges ?? []).find(
        (c) => c.from_user_id === user.id || c.opponent_user_id === user.id,
      );
      authorized = Boolean(matched);
      matchedChallengeId = matched?.id ?? null;
    }

    console.log(
      JSON.stringify({
        src: 'get-replay-url',
        event: 'authorization_result',
        requester_user_id: user.id,
        requested_scan_id: scanId,
        scan_owner_id: scan.user_id,
        is_owner: scan.user_id === user.id,
        matched_challenge_id: matchedChallengeId,
        authorization_result: authorized ? 'authorized' : 'denied',
      }),
    );

    if (!authorized) {
      return jsonResponse({ error: 'No autorizado' }, 403);
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('scans')
      .createSignedUrl(scan.video_path, SIGNED_URL_TTL_SECONDS);

    console.log(
      JSON.stringify({
        src: 'get-replay-url',
        event: 'storage_sign_result',
        requester_user_id: user.id,
        requested_scan_id: scanId,
        storage_sign_result: signErr || !signed?.signedUrl ? 'failed' : 'ok',
      }),
    );

    if (signErr || !signed?.signedUrl) {
      return jsonResponse({ error: 'No se pudo generar la URL' }, 500);
    }

    return jsonResponse({ url: signed.signedUrl });
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
