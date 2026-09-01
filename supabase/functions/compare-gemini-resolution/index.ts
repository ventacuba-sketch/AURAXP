/**
 * compare-gemini-resolution — herramienta de comparación, NO parte del
 * pipeline de producción.
 *
 * ============================================================
 * QUÉ ES ESTO
 * ============================================================
 * Analiza un Scan YA EXISTENTE (con video en Storage) dos veces con
 * Gemini: una vez con la config actual (idéntica a process-scan) y otra
 * con `generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'` -- para
 * poder comparar, con el MISMO video, score/stats/verdict/timeline/tokens/
 * latencia/costo estimado entre ambas configuraciones (ver auditoría de
 * optimización de Gemini). No escribe NADA en `scans` ni en ninguna otra
 * tabla -- de solo lectura, cero riesgo de tocar producción. Nunca se llama
 * desde la app: es una función manual/operativa, para invocar a mano
 * (Supabase Dashboard -> Edge Functions -> Invoke, o `supabase functions
 * invoke` con el JWT del dueño del scan) mientras se decide si vale la pena
 * cambiar media_resolution en producción.
 *
 * IMPORTANTE -- no verificado en vivo: este sandbox no tiene salida de red
 * a generativelanguage.googleapis.com, así que el nombre exacto del campo
 * ('mediaResolution') y sus valores ('MEDIA_RESOLUTION_LOW' etc.) están
 * tomados de la documentación pública de la Gemini API, pero NO se pudo
 * confirmar contra el modelo real (`gemini-3.6-flash`) desde acá. Antes de
 * usar esto para decidir nada, correrlo una vez y confirmar que el campo
 * "low" de la respuesta realmente difiere del "current" -- si Gemini
 * ignora el campo silenciosamente, ambos resultados van a salir idénticos
 * y eso mismo ya es la señal de que hay que revisar el nombre del campo
 * contra la documentación vigente en ese momento.
 *
 * Solo el dueño del scan puede invocar esto sobre su propio scan (mismo
 * patrón de auth que el resto de las Edge Functions) -- no expone nada de
 * otro usuario.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { analyzeVideo, deleteGeminiFile, prepareGeminiVideoFile } from '../_shared/gemini.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: scan, error: scanErr } = await admin
      .from('scans')
      .select('id, user_id, video_path')
      .eq('id', scanId)
      .single();

    if (scanErr || !scan || !scan.video_path) return jsonResponse({ error: 'Scan no encontrado' }, 404);
    if (scan.user_id !== user.id) return jsonResponse({ error: 'No autorizado' }, 403);

    const { data: videoInfo, error: infoErr } = await admin.storage.from('scans').info(scan.video_path);
    if (infoErr || !videoInfo) return jsonResponse({ error: 'No se pudo leer el video' }, 500);

    const { data: videoStream, error: streamErr } = await admin.storage
      .from('scans')
      .download(scan.video_path)
      .asStream();
    if (streamErr || !videoStream) return jsonResponse({ error: 'No se pudo leer el video' }, 500);

    const mimeType = videoInfo.contentType || 'video/mp4';

    // Un solo upload a Gemini Files -- mediaResolution afecta cómo Gemini
    // LEE el archivo ya subido, no la subida en sí, así que reusar el mismo
    // fileUri para ambas llamadas es válido y evita subir el video dos veces.
    const videoFile = await prepareGeminiVideoFile({
      apiKey: GEMINI_API_KEY,
      body: videoStream,
      sizeBytes: videoInfo.size ?? 0,
      mimeType,
      scanId,
    });

    try {
      const currentUsage: { value?: unknown } = {};
      const currentStart = Date.now();
      const currentResult = await analyzeVideo({
        apiKey: GEMINI_API_KEY,
        fileUri: videoFile.uri,
        mimeType: videoFile.mimeType,
        scanId,
        usageHolder: currentUsage,
      });
      const currentLatencyMs = Date.now() - currentStart;

      const lowUsage: { value?: unknown } = {};
      const lowStart = Date.now();
      const lowResult = await analyzeVideo({
        apiKey: GEMINI_API_KEY,
        fileUri: videoFile.uri,
        mimeType: videoFile.mimeType,
        scanId,
        usageHolder: lowUsage,
        mediaResolution: 'MEDIA_RESOLUTION_LOW',
      });
      const lowLatencyMs = Date.now() - lowStart;

      return jsonResponse({
        scanId,
        videoSizeBytes: videoInfo.size ?? null,
        current: { result: currentResult, usage: currentUsage.value ?? null, latencyMs: currentLatencyMs },
        low: { result: lowResult, usage: lowUsage.value ?? null, latencyMs: lowLatencyMs },
      });
    } finally {
      // Best-effort, mismo criterio que process-scan -- nunca debe bloquear
      // ni fallar la respuesta.
      deleteGeminiFile(GEMINI_API_KEY, videoFile.name, scanId).catch((e) =>
        console.warn('gemini file cleanup failed', e),
      );
    }
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: 'Error interno', detail: String(e) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
