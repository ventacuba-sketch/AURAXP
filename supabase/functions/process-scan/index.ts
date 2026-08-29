/**
 * process-scan — el pipeline completo de un análisis de AURAXP.
 *
 * Recibe { scanId, challengeToken? }. Corre con dos clientes:
 * - `userClient`: con el JWT de quien llama, solo para verificar dueño.
 * - `adminClient`: con service_role, ignora RLS — es el único que puede
 *   escribir status/stats/aura_score/xp_awarded en `scans`.
 *
 * Deno Edge Function (Supabase). No se ejecuta hasta hacer `supabase
 * functions deploy` contra un proyecto real.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { analyzeVideo, deleteGeminiFile, GeminiUnavailableError, prepareGeminiVideoFile } from '../_shared/gemini.ts';
import {
  computeAuraScore,
  computeLevel,
  computeXpGained,
  DAILY_UPLOAD_CAP,
  DAILY_XP_SCAN_CAP,
  noActionResult,
} from '../_shared/scoring.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Declarados afuera del try para que el catch externo pueda usarlos como
  // red de seguridad (ver abajo) -- solo tienen valor una vez que el request
  // avanzó lo suficiente como para que exista algo que limpiar.
  let scanId: string | undefined;
  let admin: ReturnType<typeof createClient> | undefined;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = await req.json();
    scanId = body.scanId;
    const challengeToken = body.challengeToken;

    if (!scanId) {
      return jsonResponse({ error: 'scanId requerido' }, 400);
    }

    // Cliente scoped al usuario que llama — solo para leer/verificar dueño.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) return jsonResponse({ error: 'No autenticado' }, 401);

    // Cliente con service_role — el único que escribe resultados.
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: scan, error: scanErr } = await admin
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single();

    if (scanErr || !scan) return jsonResponse({ error: 'Scan no encontrado' }, 404);
    if (scan.user_id !== user.id) return jsonResponse({ error: 'No autorizado' }, 403);

    // Defensa en profundidad: el path SIEMPRE debe vivir bajo la carpeta
    // del dueño, aunque la policy de Storage ya lo garantice al mintear
    // la signed URL.
    if (!scan.video_path.startsWith(`${user.id}/`)) {
      await admin
        .from('scans')
        .update({ status: 'rejected', error_message: 'invalid_path' })
        .eq('id', scanId);
      return jsonResponse({ error: 'Path inválido' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);

    // ── Rate limit de subidas/día ──────────────────────────────────────
    const { data: counter } = await admin
      .from('daily_scan_counts')
      .select('*')
      .eq('user_id', user.id)
      .eq('day', today)
      .maybeSingle();

    const uploadCount = (counter?.upload_count ?? 0) + 1;
    await admin.from('daily_scan_counts').upsert(
      { user_id: user.id, day: today, upload_count: uploadCount, xp_scan_count: counter?.xp_scan_count ?? 0 },
      { onConflict: 'user_id,day' },
    );

    if (uploadCount > DAILY_UPLOAD_CAP) {
      await admin
        .from('scans')
        .update({ status: 'rejected', error_message: 'daily_upload_limit' })
        .eq('id', scanId);
      return jsonResponse({ error: 'Límite diario alcanzado' }, 429);
    }

    // ── Dedupe por fingerprint: mismo video ya analizado ────────────────
    const { data: previous } = await admin
      .from('scans')
      .select('*')
      .eq('user_id', user.id)
      .eq('video_hash', scan.video_hash)
      .eq('status', 'done')
      .neq('id', scanId)
      .limit(1)
      .maybeSingle();

    if (previous) {
      await admin
        .from('scans')
        .update({
          status: 'done',
          gemini_raw: previous.gemini_raw,
          stats: previous.stats,
          beats: previous.beats,
          verdict_headline: previous.verdict_headline,
          verdict_tag: previous.verdict_tag,
          aura_score: previous.aura_score,
          xp_awarded: 0, // ya se pagó la primera vez — evita farmear resubiendo el mismo clip
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', scanId);
      return jsonResponse({ ok: true, duplicate: true });
    }

    await admin.from('scans').update({ status: 'processing' }).eq('id', scanId);

    // ── Leer el video y subirlo a Gemini sin bufferizarlo completo ──────
    // Antes: .download() (Blob completo) + .arrayBuffer() + base64 +
    // JSON.stringify inline -- 3-4 copias superpuestas del video en
    // memoria, la causa real del "Memory limit exceeded" en producción
    // (ver diagnóstico). Ahora: leemos metadata (tamaño/mime) sin
    // descargar nada, streameamos el video directo desde Storage a la
    // Files API de Gemini, y lo referenciamos por URI -- nunca se arma un
    // string base64 del video completo.
    const { data: videoInfo, error: infoErr } = await admin.storage.from('scans').info(scan.video_path);
    if (infoErr || !videoInfo) {
      await admin
        .from('scans')
        .update({ status: 'failed', error_message: 'video_info_failed' })
        .eq('id', scanId);
      return jsonResponse({ error: 'No se pudo leer el video' }, 500);
    }

    const { data: videoStream, error: streamErr } = await admin.storage
      .from('scans')
      .download(scan.video_path)
      .asStream();

    if (streamErr || !videoStream) {
      await admin
        .from('scans')
        .update({ status: 'failed', error_message: 'download_failed' })
        .eq('id', scanId);
      return jsonResponse({ error: 'No se pudo leer el video' }, 500);
    }

    const mimeType = videoInfo.contentType || 'video/mp4';

    let videoFile;
    try {
      videoFile = await prepareGeminiVideoFile({
        apiKey: GEMINI_API_KEY,
        body: videoStream,
        sizeBytes: videoInfo.size ?? 0,
        mimeType,
        scanId,
      });
    } catch (e) {
      await admin
        .from('scans')
        .update({ status: 'failed', error_message: `video_upload_failed: ${String(e)}` })
        .eq('id', scanId);
      return jsonResponse({ error: 'No se pudo preparar el video' }, 500);
    }

    let gemini;
    try {
      // El retry ante 503/UNAVAILABLE ya vive dentro de analyzeVideo() (con
      // backoff exponencial) -- acá no hace falta reintentar nada más: si
      // esto lanza, es porque ya se agotaron esos intentos o el error no
      // era retryable de entrada (ver _shared/gemini.ts).
      gemini = await analyzeVideo({ apiKey: GEMINI_API_KEY, fileUri: videoFile.uri, mimeType: videoFile.mimeType, scanId });
    } catch (e) {
      // Código corto y legible cuando Gemini siguió indisponible tras los
      // reintentos (mismo patrón que invalid_path/daily_upload_limit/etc.
      // más arriba) -- AnalyzingScreen lo usa para mostrar un mensaje
      // específico en vez del texto crudo del error.
      const errorMessage = e instanceof GeminiUnavailableError ? 'gemini_unavailable' : String(e);
      console.log(
        JSON.stringify({
          src: 'process-scan',
          event: 'analyze_failed',
          scanId,
          isGeminiUnavailable: e instanceof GeminiUnavailableError,
          errorMessageSaved: errorMessage,
        }),
      );
      await admin
        .from('scans')
        .update({ status: 'failed', error_message: errorMessage })
        .eq('id', scanId);
      return jsonResponse({ error: 'Análisis falló' }, 502);
    } finally {
      // Best-effort: liberar el archivo en Gemini apenas terminamos con
      // él. Nunca debe bloquear ni fallar el scan -- Gemini lo expira
      // solo a las 48h de todos modos.
      deleteGeminiFile(GEMINI_API_KEY, videoFile.name, scanId).catch((e) =>
        console.warn('gemini file cleanup failed', e),
      );
    }

    // ── Moderación ───────────────────────────────────────────────────
    if (gemini.moderation.flagged) {
      await admin
        .from('scans')
        .update({
          status: 'rejected',
          gemini_raw: gemini,
          moderation_flagged: true,
          moderation_reason: gemini.moderation.reason,
          xp_awarded: 0,
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', scanId);
      return jsonResponse({ ok: true, rejected: true });
    }

    // ── Sin acción reconocible: -50 Aura fijo, 0 XP, no consume cupo ────
    const outcome = gemini.signals.hasClearAction
      ? computeAuraScore(gemini)
      : noActionResult();

    const countsForXp = gemini.signals.hasClearAction;
    const xpScanCount = counter?.xp_scan_count ?? 0;
    const dailyXpCapReached = xpScanCount >= DAILY_XP_SCAN_CAP;

    const xpAwarded = computeXpGained({
      tier: outcome.tier,
      countsForXp,
      dailyXpCapReached,
    });

    if (countsForXp && xpAwarded > 0) {
      await admin
        .from('daily_scan_counts')
        .update({ xp_scan_count: xpScanCount + 1 })
        .eq('user_id', user.id)
        .eq('day', today);
    }

    await admin
      .from('scans')
      .update({
        status: 'done',
        gemini_raw: gemini,
        stats: gemini.scores,
        beats: 'beats' in outcome ? outcome.beats : [],
        verdict_headline: gemini.verdict.headline,
        verdict_tag: outcome.verdictTag,
        aura_score: outcome.auraScore,
        xp_awarded: xpAwarded,
        analyzed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    // ── Actualizar XP/nivel acumulado del perfil ────────────────────────
    if (xpAwarded > 0) {
      const { data: profile } = await admin
        .from('profiles')
        .select('xp')
        .eq('id', user.id)
        .single();
      const newXp = (profile?.xp ?? 0) + xpAwarded;
      await admin
        .from('profiles')
        .update({ xp: newXp, level: computeLevel(newXp) })
        .eq('id', user.id);
    }

    // ── Vincular al challenge si venía de un link ───────────────────────
    if (challengeToken) {
      await admin
        .from('challenges')
        .update({ target_scan_id: scanId })
        .eq('share_token', challengeToken);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error(e);

    // Red de seguridad: todo lo anterior a esto ya marca 'failed' en su
    // propio catch específico ante un error esperado (video ilegible, subida
    // a Gemini caída, análisis fallido, etc.). Si el código llegó hasta acá
    // es porque algo *no previsto* explotó -- un error de Postgres en el
    // upsert de daily_scan_counts, en la actualización de profiles/
    // challenges, o cualquier otra cosa -- después de que el scan ya había
    // pasado a 'processing'. Sin esto, esa fila quedaría en 'processing'
    // para siempre: el cliente invoca esta función fire-and-forget (ver
    // scanService.ts) y nunca ve este 500, solo sigue haciendo polling de
    // un status que ya no va a cambiar.
    if (scanId && admin) {
      try {
        await admin
          .from('scans')
          .update({ status: 'failed', error_message: 'unexpected_error' })
          .eq('id', scanId);
      } catch (updateErr) {
        console.error('No se pudo marcar el scan como failed en el catch externo', updateErr);
      }
    }

    return jsonResponse({ error: 'Error interno' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
