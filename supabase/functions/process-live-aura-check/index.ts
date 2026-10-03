/**
 * process-live-aura-check -- análisis PUNTUAL de un clip de ~8s capturado
 * durante un LIVE (sección 18 del pedido: "⚡ AURA CHECK", nunca análisis
 * continuo de una transmisión entera).
 *
 * Reutiliza exactamente la misma lógica de Gemini/scoring que
 * process-scan (`_shared/gemini.ts`, `_shared/scoring.ts`) -- ambas son
 * funciones puras sin efectos secundarios, así que importarlas acá no
 * duplica ni el prompt ni el modelo de puntuación. La diferencia real con
 * process-scan es deliberada: esta función JAMÁS toca `scans`,
 * `profiles.xp/level`, `wallets`, `coin_transactions` ni
 * `daily_scan_counts` -- un Aura Check de LIVE no otorga XP, no otorga
 * Coins, no altera rachas, no completa misiones de Scan, y no reemplaza
 * el último Scan oficial del usuario (todo esto, literal, sección 18).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { analyzeVideo, deleteGeminiFile, GeminiUnavailableError, prepareGeminiVideoFile } from '../_shared/gemini.ts';
import { computeAuraScore, noActionResult } from '../_shared/scoring.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const BUCKET = 'live-aura-checks';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * Aura Check es efímero (sección 18/auditoría GPT hallazgo #6): el clip
 * original en Storage NO debe acumularse indefinidamente una vez que el
 * procesamiento llega a un estado TERMINAL (done/failed, con cualquier
 * error_message -- moderación, Gemini no disponible, fallo de red, etc).
 * Best-effort a propósito: un fallo al BORRAR nunca debe convertir un
 * análisis que sí funcionó en un error para el usuario -- solo se
 * registra con `console.warn`, nunca se relanza. Llamar esto únicamente
 * con un `storagePath` que YA pasó la validación `startsWith(user.id/)`
 * de abajo -- nunca con un path todavía no confirmado como propio del
 * usuario (ver el comentario en la rama `invalid_path`).
 */
async function cleanupStorageClip(admin: ReturnType<typeof createClient>, storagePath: string, checkId: string): Promise<void> {
  try {
    const { error } = await admin.storage.from(BUCKET).remove([storagePath]);
    if (error) console.warn(JSON.stringify({ src: 'process-live-aura-check', event: 'storage_cleanup_failed', checkId, message: error.message }));
  } catch (e) {
    console.warn(JSON.stringify({ src: 'process-live-aura-check', event: 'storage_cleanup_failed', checkId, message: String(e) }));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let checkId: string | undefined;
  let admin: ReturnType<typeof createClient> | undefined;
  // Solo se setea DESPUÉS de pasar la validación `startsWith(user.id/)`
  // de abajo -- el catch externo nunca debe intentar borrar un path que
  // todavía no se confirmó como propio del usuario.
  let validatedStoragePath: string | undefined;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = await req.json();
    checkId = body.checkId;
    if (!checkId) return jsonResponse({ error: 'checkId requerido' }, 400);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: 'No autenticado' }, 401);

    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: check, error: checkErr } = await admin
      .from('live_aura_checks')
      .select('*')
      .eq('id', checkId)
      .single();

    if (checkErr || !check) return jsonResponse({ error: 'Aura Check no encontrado' }, 404);
    // Defensa en profundidad -- request_live_aura_check (RPC) ya exige
    // ser el host de la sala para crear esta fila; acá se reconfirma que
    // quien pide procesarla es la misma persona que la pidió, mismo
    // criterio que process-scan verificando scan.user_id === user.id.
    if (check.requested_by !== user.id) return jsonResponse({ error: 'No autorizado' }, 403);
    if (check.status !== 'pending') {
      // Ya procesado (reintento del cliente) -- nunca reprocesa ni
      // factura una segunda llamada a Gemini por el mismo clip.
      return jsonResponse({ ok: true, status: check.status });
    }
    if (!check.storage_path.startsWith(`${user.id}/`)) {
      // NUNCA borrar acá -- este path todavía no se confirmó como propio
      // del usuario (defensa en profundidad contra un p_storage_path mal
      // formado o manipulado desde algún bug upstream en
      // request_live_aura_check); borrar con el cliente service_role un
      // path no validado sería un primitivo de borrado arbitrario.
      await admin.from('live_aura_checks').update({ status: 'failed', error_message: 'invalid_path' }).eq('id', checkId);
      return jsonResponse({ error: 'Path inválido' }, 400);
    }
    validatedStoragePath = check.storage_path;

    await admin.from('live_aura_checks').update({ status: 'processing' }).eq('id', checkId);

    const { data: videoInfo, error: infoErr } = await admin.storage.from(BUCKET).info(check.storage_path);
    if (infoErr || !videoInfo) {
      await admin.from('live_aura_checks').update({ status: 'failed', error_message: 'video_info_failed' }).eq('id', checkId);
      await cleanupStorageClip(admin, check.storage_path, checkId);
      return jsonResponse({ error: 'No se pudo leer el clip' }, 500);
    }

    const { data: videoStream, error: streamErr } = await admin.storage.from(BUCKET).download(check.storage_path).asStream();
    if (streamErr || !videoStream) {
      await admin.from('live_aura_checks').update({ status: 'failed', error_message: 'download_failed' }).eq('id', checkId);
      await cleanupStorageClip(admin, check.storage_path, checkId);
      return jsonResponse({ error: 'No se pudo leer el clip' }, 500);
    }

    const mimeType = videoInfo.contentType || 'video/mp4';

    let videoFile;
    try {
      videoFile = await prepareGeminiVideoFile({
        apiKey: GEMINI_API_KEY,
        body: videoStream,
        sizeBytes: videoInfo.size ?? 0,
        mimeType,
        scanId: checkId,
      });
    } catch (e) {
      await admin
        .from('live_aura_checks')
        .update({ status: 'failed', error_message: `video_upload_failed: ${String(e)}` })
        .eq('id', checkId);
      // prepareGeminiVideoFile ya terminó (con error) de leer el stream
      // de Storage acá -- seguro borrar, nada más lo va a volver a leer.
      await cleanupStorageClip(admin, check.storage_path, checkId);
      return jsonResponse({ error: 'No se pudo preparar el clip' }, 500);
    }

    let gemini;
    try {
      gemini = await analyzeVideo({
        apiKey: GEMINI_API_KEY,
        fileUri: videoFile.uri,
        mimeType: videoFile.mimeType,
        scanId: checkId,
        usageHolder: {},
      });
    } catch (e) {
      const errorMessage = e instanceof GeminiUnavailableError ? 'gemini_unavailable' : String(e);
      await admin.from('live_aura_checks').update({ status: 'failed', error_message: errorMessage }).eq('id', checkId);
      // analyzeVideo ya devolvió (con error) -- Gemini ya terminó de
      // consumir el fileUri que subió prepareGeminiVideoFile; el objeto
      // ORIGINAL de nuestro Storage ya no hace falta.
      await cleanupStorageClip(admin, check.storage_path, checkId);
      return jsonResponse({ error: 'Análisis falló' }, 502);
    } finally {
      deleteGeminiFile(GEMINI_API_KEY, videoFile.name, checkId).catch((e) => console.warn('gemini file cleanup failed', e));
    }

    if (gemini.moderation.flagged) {
      // Nunca se muestra un resultado para contenido moderado -- ni
      // overlay, ni número, nada (mismo criterio que process-scan
      // rechazando un scan moderado).
      await admin
        .from('live_aura_checks')
        .update({ status: 'failed', error_message: 'moderation_flagged' })
        .eq('id', checkId);
      await cleanupStorageClip(admin, check.storage_path, checkId);
      return jsonResponse({ ok: true, rejected: true });
    }

    // Campos REALES que Gemini de verdad produce (confidence/style/
    // timing/cringeRisk, ver _shared/scoring.ts GeminiScores) -- nunca
    // "presencia/originalidad" u otro campo que el pipeline no calcula.
    // auraScore/verdictTag salen de la MISMA función pura que usa
    // process-scan -- cero lógica de scoring nueva o duplicada.
    const outcome = gemini.signals.hasClearAction ? computeAuraScore(gemini) : noActionResult();

    const result = {
      confidence: gemini.scores.confidence,
      style: gemini.scores.style,
      timing: gemini.scores.timing,
      cringeRisk: gemini.scores.cringeRisk,
      auraScore: outcome.auraScore,
      verdictTag: outcome.verdictTag,
      headline: gemini.verdict.headline,
    };

    await admin
      .from('live_aura_checks')
      .update({ status: 'done', result, completed_at: new Date().toISOString() })
      .eq('id', checkId);
    await cleanupStorageClip(admin, check.storage_path, checkId);

    // NUNCA: profiles.xp/level, wallets, coin_transactions,
    // daily_scan_counts, scans -- ver el comentario de arriba del archivo.

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error(e);
    if (checkId && admin) {
      try {
        await admin.from('live_aura_checks').update({ status: 'failed', error_message: 'unexpected_error' }).eq('id', checkId);
      } catch (updateErr) {
        console.error('No se pudo marcar el Aura Check como failed en el catch externo', updateErr);
      }
      // Este catch es SIEMPRE un estado terminal para este checkId (un
      // reintento del cliente encuentra status != 'pending' y nunca
      // vuelve a leer el storage_path) -- limpiar acá también, pero
      // SOLO si ya pasamos la validación de path (nunca con un path sin
      // confirmar, mismo criterio que la rama invalid_path de arriba).
      if (validatedStoragePath) await cleanupStorageClip(admin, validatedStoragePath, checkId);
    }
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});
