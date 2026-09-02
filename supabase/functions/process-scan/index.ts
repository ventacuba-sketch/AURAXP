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
import { resolveChallengeIfApplicable } from '../_shared/challengeResolution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { isUnlimitedTester, PlanTier, resolveDailyCap } from '../_shared/dailyLimit.ts';
import { analyzeVideo, deleteGeminiFile, GeminiUnavailableError, prepareGeminiVideoFile } from '../_shared/gemini.ts';
import {
  computeAuraScore,
  computeLevel,
  computeXpGained,
  DAILY_XP_SCAN_CAP,
  noActionResult,
} from '../_shared/scoring.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

// Límite real de 8s (auditoría post-iPhone, punto 14): el cliente ya lo
// valida ANTES de subir (UploadScreen/RecordScreen), pero eso nunca
// alcanza solo -- nada impide pegarle directo al insert de `scans` con
// un video más largo. 8.5s en vez de 8.0 le da margen a la lectura de
// Gemini (aproximada, no un decoder cuadro a cuadro) sin arriesgar
// rechazar un clip válido grabado justo en el límite.
const MAX_SERVER_DURATION_SEC = 8.5;

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

    // ── Kill switch de costo (ver migración system_status) ──────────────
    // Chequeo barato (una fila, indexada por PK) ANTES de tocar Gemini --
    // el único paso que factura. En 'normal' (el default, y hoy el único
    // valor que existe en producción) esto es un no-op total. Solo
    // 'emergency' bloquea -- 'high_demand' es puramente informativo para el
    // frontend (ver get-daily-scan-status), process-scan sigue aceptando
    // Scans igual en ese modo.
    const { data: systemStatus } = await admin.from('system_status').select('mode').eq('id', true).maybeSingle();
    if (systemStatus?.mode === 'emergency') {
      await admin
        .from('scans')
        .update({ status: 'rejected', error_message: 'service_paused' })
        .eq('id', scanId);
      return jsonResponse({ error: 'Análisis pausado temporalmente' }, 503);
    }

    const today = new Date().toISOString().slice(0, 10);

    // ── Rate limit de subidas/día -- plan-aware (ver _shared/dailyLimit.ts,
    // la misma función que usa get-daily-scan-status para lo que le
    // muestra al usuario) ────────────────────────────────────────────────
    const { data: planRow } = await admin
      .from('profiles')
      .select('plan, created_at, is_unlimited_tester')
      .eq('id', user.id)
      .single();

    const { cap, isFairUseCap } = resolveDailyCap({
      plan: (planRow?.plan as PlanTier | undefined) ?? 'free',
      accountCreatedAt: planRow?.created_at ?? new Date().toISOString(),
      unlimitedTestAccount: isUnlimitedTester(user.id, planRow?.is_unlimited_tester as boolean | undefined),
    });

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

    if (uploadCount > cap) {
      // Mismo código para FREE que antes ('daily_upload_limit' -- AnalyzingScreen
      // ya lo traduce a un mensaje claro con CTA a PRO). Un PRO que golpea el
      // techo de fair-use interno (caso excepcional) recibe un código distinto
      // a propósito: el mensaje que ve tiene que ser neutro de protección de
      // servicio, nunca "tu plan en realidad era de 100 Scans".
      await admin
        .from('scans')
        .update({ status: 'rejected', error_message: isFairUseCap ? 'fair_use_limit' : 'daily_upload_limit' })
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
    // Se llena adentro de analyzeVideo() si Gemini devuelve usageMetadata
    // -- se persiste en scans.gemini_usage_metadata más abajo para poder
    // medir el costo real por Scan por SQL (ver auditoría de escala).
    const geminiUsage: { value?: unknown } = {};
    try {
      // El retry ante 503/UNAVAILABLE ya vive dentro de analyzeVideo() (con
      // backoff exponencial) -- acá no hace falta reintentar nada más: si
      // esto lanza, es porque ya se agotaron esos intentos o el error no
      // era retryable de entrada (ver _shared/gemini.ts).
      gemini = await analyzeVideo({
        apiKey: GEMINI_API_KEY,
        fileUri: videoFile.uri,
        mimeType: videoFile.mimeType,
        scanId,
        usageHolder: geminiUsage,
      });
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
          gemini_usage_metadata: geminiUsage.value ?? null,
          moderation_flagged: true,
          moderation_reason: gemini.moderation.reason,
          xp_awarded: 0,
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', scanId);
      return jsonResponse({ ok: true, rejected: true });
    }

    // ── Límite de 8s, validado server-side (punto 14, auditoría post-
    // iPhone) ──────────────────────────────────────────────────────────
    // `observedDurationSec` es la lectura de Gemini sobre el archivo
    // real, no el `duration_ms` que mandó el cliente al crear el scan --
    // ese es auto-reportado y nunca se verificaba. 0 significa "Gemini no
    // lo reportó" (ver validateGeminiResult): en ese caso NUNCA se
    // rechaza sobre un dato ausente, se deja pasar como antes.
    if (gemini.observedDurationSec && gemini.observedDurationSec > MAX_SERVER_DURATION_SEC) {
      await admin
        .from('scans')
        .update({
          status: 'rejected',
          gemini_raw: gemini,
          gemini_usage_metadata: geminiUsage.value ?? null,
          error_message: 'duration_exceeded_server_check',
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

    // ── Consumibles armados (puntos 3/4, auditoría post-iPhone) ─────────
    // Justo acá, y no antes: este es el primer punto donde el Scan
    // realmente va a terminar 'done' -- si Gemini hubiera fallado, o el
    // scan se hubiera rechazado por moderación/duración arriba, nunca se
    // llega hasta acá y el consumible se queda armado (nunca se
    // consume). `admin` ignora RLS a propósito -- es el mismo cliente
    // service_role que ya escribe status/xp en `scans`.
    let consumableEffectKey: string | null = null;
    const { data: armed } = await admin
      .from('inventory_items')
      .select('id, store_items(item_key)')
      .eq('user_id', user.id)
      .not('armed_at', 'is', null)
      .is('consumed_at', null)
      .order('armed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (armed) {
      const raw = armed.store_items as { item_key: string } | { item_key: string }[] | null;
      const itemKey = Array.isArray(raw) ? raw[0]?.item_key : raw?.item_key;
      // `.is('consumed_at', null)` en el UPDATE + `.select('id')` para
      // saber si REALMENTE actualizó algo: guard contra una carrera
      // improbable (dos Scans del mismo usuario terminando casi a la
      // vez) -- si ya lo consumió el otro, esto no actualiza ninguna
      // fila y consumableEffectKey se queda null.
      const { data: consumedRows, error: consumeErr } = await admin
        .from('inventory_items')
        .update({ consumed_at: new Date().toISOString(), armed_at: null })
        .eq('id', armed.id)
        .is('consumed_at', null)
        .select('id');
      if (!consumeErr && consumedRows && consumedRows.length > 0) consumableEffectKey = itemKey ?? null;
    }

    await admin
      .from('scans')
      .update({
        status: 'done',
        gemini_raw: gemini,
        gemini_usage_metadata: geminiUsage.value ?? null,
        stats: gemini.scores,
        beats: 'beats' in outcome ? outcome.beats : [],
        verdict_headline: gemini.verdict.headline,
        verdict_tag: outcome.verdictTag,
        aura_score: outcome.auraScore,
        xp_awarded: xpAwarded,
        consumable_effect_key: consumableEffectKey,
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

    // ── Resolver el Challenge, si este scan es el del oponente ──────────
    // Best-effort a propósito: el scan de este usuario ya se guardó como
    // 'done' arriba -- pase lo que pase acá, eso no se revierte. Si algo
    // falla, el Challenge simplemente queda 'accepted' sin resolver y el
    // usuario puede reintentar subiendo de nuevo (mismo challengeToken).
    if (challengeToken) {
      try {
        await resolveChallengeIfApplicable({
          admin,
          challengeToken,
          opponentScanOwnerId: user.id,
          opponentScanId: scanId,
        });
      } catch (e) {
        console.error('resolveChallengeIfApplicable failed', e);
      }
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
