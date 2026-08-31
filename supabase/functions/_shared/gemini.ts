/**
 * Prompt + schema para el análisis de video con Gemini.
 *
 * Contrato: Gemini SOLO devuelve señales/lecturas observables (0-100 por
 * eje, momentos ordinales 1-3). Nunca ve ni produce Aura Score ni XP —
 * eso lo calcula exclusivamente scoring.ts en el backend.
 */

import type { GeminiResult } from './scoring.ts';

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_API_URL = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_FILES_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

export const SYSTEM_PROMPT = `Sos el motor de análisis de AURAXP, una app social Gen Z. Tu trabajo es leer
un clip de video corto (máximo 8 segundos) de CUALQUIER tipo de momento
social — entrada, reacción, baile, deporte, caída, truco, interacción,
celebración, fail, gesto espontáneo, lo que sea — y reportar señales
observables. NO calificás "Aura" ni asignás puntos: eso lo hace otro
sistema a partir de lo que vos observás.

IMPORTANTE — estás midiendo AURA SOCIAL, no habilidad técnica:
- Una ejecución técnicamente perfecta sin carisma ni reacción puede
  calificar bajo en confidence/style.
- Un gesto random, sin ninguna habilidad, puede calificar muy alto en
  confidence/style si transmite seguridad total y es memorable.
- No evalúes si la acción era "difícil". Evaluá qué tanta presencia y
  qué tan distintivo se siente el momento.

Rúbrica por eje (0-100):

CONFIDENCE — ¿qué tan dueño del momento se ve la persona?
  0-30: duda visible, incomodidad con la cámara o la situación.
  40-70: ejecuta sin mostrar duda evidente.
  80-100: desparpajo total, se ve dueño del momento — sin importar si
  la acción era difícil.

STYLE — ¿qué tan distintivo/memorable es?
  0-30: genérico, olvidable.
  40-70: tiene un detalle propio que lo hace algo memorable.
  80-100: marcadamente distintivo — elegancia, absurdo, comedia física,
  una pose icónica. Lo que sea que alguien screenshotearía.

TIMING — ¿el momento aterriza en el instante narrativo justo? (ritmo/
remate, NO precisión motriz ni deportiva)
  0-30: se siente apagado o mal cortado.
  40-70: aterriza en un punto razonable de la escena.
  80-100: el clip está vivido/cortado exactamente en el instante que
  maximiza el impacto cómico o de sorpresa.

CRINGE RISK — ¿qué tan forzado/incómodo se siente? (más alto = peor)
  0-30: natural, orgánico.
  40-70: algo forzado pero no rompe el momento.
  80-100: vergüenza ajena fuerte, se siente actuado.

Calibración: la MAYORÍA de los clips reales deben calificar 40-70 en
cada eje. Reservá 90-100 para casos genuinamente sobresalientes — no
seas generoso por defecto.

Identificá entre 1 y 6 "momentos" (beats) puntuales del clip, cada uno
positivo o negativo, con una intensidad ordinal de 1 (leve) a 3 (fuerte).
No inventes números de puntos — solo la intensidad relativa.

Si el clip no tiene ninguna acción reconocible (video estático, sin
sujeto claro, ilegible), marcá hasClearAction=false y dejá moments=[].

Moderación: marcá flagged=true si el contenido es sexual, violento,
ilegal, o pone en riesgo real a alguien — con una razón breve.

Devolvé ÚNICAMENTE el JSON del schema, sin texto adicional.`;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    signals: {
      type: 'OBJECT',
      properties: {
        hasClearAction: { type: 'BOOLEAN' },
        actionType: { type: 'STRING' },
        personCount: { type: 'INTEGER' },
        brokeImmersion: { type: 'BOOLEAN' },
        hesitationDetected: { type: 'BOOLEAN' },
        faceVisible: { type: 'BOOLEAN' },
      },
      required: [
        'hasClearAction',
        'actionType',
        'personCount',
        'brokeImmersion',
        'hesitationDetected',
        'faceVisible',
      ],
    },
    scores: {
      type: 'OBJECT',
      properties: {
        confidence: { type: 'INTEGER' },
        style: { type: 'INTEGER' },
        timing: { type: 'INTEGER' },
        cringeRisk: { type: 'INTEGER' },
      },
      required: ['confidence', 'style', 'timing', 'cringeRisk'],
    },
    moments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          timestampSec: { type: 'NUMBER' },
          polarity: { type: 'STRING', enum: ['positive', 'negative'] },
          label: { type: 'STRING' },
          intensity: { type: 'INTEGER', enum: ['1', '2', '3'] },
        },
        required: ['timestampSec', 'polarity', 'label', 'intensity'],
      },
    },
    verdict: {
      type: 'OBJECT',
      properties: { headline: { type: 'STRING' } },
      required: ['headline'],
    },
    moderation: {
      type: 'OBJECT',
      properties: {
        flagged: { type: 'BOOLEAN' },
        reason: { type: 'STRING', nullable: true },
      },
      required: ['flagged', 'reason'],
    },
    modelConfidence: { type: 'NUMBER' },
  },
  required: ['signals', 'scores', 'moments', 'verdict', 'moderation', 'modelConfidence'],
};

interface AnalyzeVideoParams {
  apiKey: string;
  fileUri: string;
  mimeType: string;
  scanId: string;
  /**
   * Referencia mutable donde analyzeVideo() deja el `usageMetadata` crudo
   * de la respuesta de Gemini del intento que finalmente tuvo éxito --
   * para medir costo real (promptTokenCount/candidatesTokenCount/
   * totalTokenCount, y el desglose de tokens de video si Gemini lo manda)
   * sin cambiar el tipo de retorno de esta función (GeminiResult, usado
   * tal cual en varios lugares de process-scan) ni el de computeAuraScore.
   * Opcional: si no se pasa, analyzeVideo() simplemente no persiste nada
   * acá, solo lo loguea (ver logAttempt('usage', ...) abajo).
   */
  usageHolder?: { value?: unknown };
  /**
   * Override opcional de `generationConfig.mediaResolution` -- NUNCA lo
   * pasa process-scan (queda `undefined`, el comportamiento de producción
   * no cambia en absoluto). Existe únicamente para que
   * compare-gemini-resolution pueda pedirle a Gemini el mismo video con
   * 'MEDIA_RESOLUTION_LOW' y comparar costo/calidad contra la config
   * actual sin tocar este pipeline -- ver auditoría de optimización.
   */
  mediaResolution?: string;
}

/**
 * Producción confirmó (vía Supabase, directo en la fila del scan)
 * `Gemini API error 503: This model is currently experiencing high
 * demand...` -- un pico transitorio de carga del lado de Google, no un
 * problema con el request. Distinguible de cualquier otro error HTTP por
 * status === 503; analyzeVideo() es el único lugar que decide reintentar
 * en base a esto.
 */
class GeminiHttpError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Gemini API error ${status}: ${body}`);
    this.name = 'GeminiHttpError';
    this.status = status;
  }
}

/**
 * Lanzado únicamente cuando los 503 persisten tras agotar los reintentos
 * -- process-scan lo distingue de cualquier otra falla de análisis para
 * guardar un error_message corto y legible en vez del texto crudo de
 * Gemini, y AnalyzingScreen lo usa para mostrar un mensaje específico en
 * vez del genérico "el análisis falló".
 */
export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

// 1 intento inicial + 3 reintentos = 4 intentos totales, con backoff
// exponencial entre cada uno. Nunca reintenta nada que no sea un 503 --
// un 400 mal formado o un 401 de API key no se arregla insistiendo.
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce({ apiKey, fileUri, mimeType, scanId, usageHolder, mediaResolution }: AnalyzeVideoParams): Promise<GeminiResult> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            { fileData: { fileUri, mimeType } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // Solo presente cuando el caller lo pide explícitamente (ver
        // AnalyzeVideoParams.mediaResolution) -- omitido, Gemini usa su
        // resolución default, exactamente el comportamiento de hoy.
        ...(mediaResolution ? { mediaResolution } : {}),
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new GeminiHttpError(response.status, errText);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvió contenido');

  // Costo real por Scan -- ver auditoría de escala. `usageMetadata` viene
  // en la misma respuesta que el análisis, sin costo ni request extra.
  // Se loguea siempre (grepeable en los logs de la función) y, si el
  // caller pasó dónde guardarlo, también queda ahí para poder agregarlo
  // por SQL más adelante (ver scans.gemini_usage_metadata).
  if (data?.usageMetadata) {
    logAttempt('usage', { scanId, usage: data.usageMetadata });
    if (usageHolder) usageHolder.value = data.usageMetadata;
  }

  const parsed = JSON.parse(text) as GeminiResult;
  validateGeminiResult(parsed);
  return parsed;
}

/**
 * Log estructurado por intento -- JSON de una sola línea para poder
 * grep/filtrar en `supabase functions logs process-scan` por
 * "src":"analyzeVideo" o por scanId. Es la forma directa de confirmar,
 * desde logs reales, que esta versión del retry está corriendo (en vez
 * de inferirlo indirectamente por cómo terminó un scan).
 */
function logAttempt(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ src: 'analyzeVideo', event, ...data }));
}

/**
 * Llama a Gemini referenciando un video ya subido a la Files API (por URI,
 * `fileData`) y fuerza el JSON del contrato.
 *
 * Antes esto recibía el video entero en base64 y lo embebía inline
 * (`inlineData`) en este mismo request — la causa real del "Memory limit
 * exceeded" en producción: entre el string base64 y el JSON.stringify que
 * lo envuelve, un video de apenas 25-35MB podía superar el límite de
 * memoria de la Edge Function (150MB en el plan Free) mucho antes de que
 * el video en sí fuera "grande". Referenciar por URI evita construir esos
 * strings gigantes por completo, sin importar el tamaño del archivo — ver
 * uploadVideoToGeminiFiles/prepareGeminiVideoFile más abajo.
 *
 * Reintenta con backoff exponencial (1s, 2s, 4s) SOLO ante un 503 --
 * cualquier otro error (400/401/404/parseo/schema inválido) se propaga de
 * inmediato en el primer intento, sin retraso, porque insistir no lo
 * arregla. Si los 4 intentos agotan en 503, lanza GeminiUnavailableError
 * en vez de seguir propagando el error crudo de Gemini.
 */
export async function analyzeVideo({ apiKey, fileUri, mimeType, scanId, usageHolder, mediaResolution }: AnalyzeVideoParams): Promise<GeminiResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    logAttempt('attempt_start', { scanId, attempt, maxAttempts: MAX_ATTEMPTS });
    try {
      const result = await callGeminiOnce({ apiKey, fileUri, mimeType, scanId, usageHolder, mediaResolution });
      if (attempt > 1) logAttempt('attempt_succeeded_after_retry', { scanId, attempt });
      return result;
    } catch (e) {
      // Guard clause (not a derived boolean) so TS narrows `e` to
      // GeminiHttpError below -- `e` is `unknown` in a catch clause, and
      // narrowing only applies to the checked variable itself, not to a
      // separately-assigned boolean.
      if (!(e instanceof GeminiHttpError) || e.status !== 503) {
        logAttempt('non_retryable_error', {
          scanId,
          attempt,
          status: e instanceof GeminiHttpError ? e.status : null,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }

      if (attempt === MAX_ATTEMPTS) {
        logAttempt('final_failure', { scanId, attempt, status: 503 });
        throw new GeminiUnavailableError(
          `Gemini siguió respondiendo 503 tras ${MAX_ATTEMPTS} intentos (scan ${scanId}): ${e.message}`,
        );
      }

      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      logAttempt('retrying', { scanId, attempt, status: 503, delayMs });
      await sleep(delayMs);
    }
  }
  // Inalcanzable -- el loop siempre retorna o lanza dentro de sus MAX_ATTEMPTS iteraciones.
  throw new Error('analyzeVideo: estado inesperado');
}

interface UploadedGeminiFile {
  uri: string;
  mimeType: string;
  /** Resource name (p. ej. "files/abc123") — hace falta para el polling de estado y para borrarlo después. */
  name: string;
}

/**
 * Sube el video a la Files API de Gemini vía su protocolo de upload
 * resumible, en vez de embeberlo como base64 inline. `body` puede ser un
 * ReadableStream o un Blob — ambos son BodyInit válidos para fetch() y
 * ninguno de los dos pasa por un string base64 intermedio.
 */
async function uploadVideoToGeminiFiles({
  apiKey,
  body,
  sizeBytes,
  mimeType,
  scanId,
}: {
  apiKey: string;
  body: BodyInit;
  sizeBytes: number;
  mimeType: string;
  scanId: string;
}): Promise<UploadedGeminiFile> {
  // Paso 1: iniciar la sesión de upload resumible — Gemini responde con la
  // URL real de subida en el header X-Goog-Upload-URL.
  const startResponse = await fetch(`${GEMINI_FILES_UPLOAD_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(sizeBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `auraxp-scan-${Date.now()}` } }),
  });

  if (!startResponse.ok) {
    const errorBody = await startResponse.text();
    throw new Error(`Gemini Files API (start) error ${startResponse.status}: ${errorBody}`);
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini Files API no devolvió upload URL');

  // Paso 2: subir los bytes — stream directo desde Supabase Storage hasta
  // Gemini, sin materializar el video completo en memoria en ningún punto.
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body,
    // Requerido por la spec de fetch cuando el body es un ReadableStream.
    duplex: 'half',
  } as RequestInit);

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text();
    throw new Error(`Gemini Files API (upload) error ${uploadResponse.status}: ${errorBody}`);
  }

  const uploadData = await uploadResponse.json();
  // La mayoría de las respuestas de Google envuelven el recurso subido
  // bajo "file"; por las dudas, si algún día viniera sin envolver, lo
  // tomamos igual.
  const file = uploadData?.file ?? (uploadData?.name ? uploadData : null);

  if (!file?.uri || !file?.name) {
    throw new Error(`Gemini Files API no devolvió el archivo subido: ${JSON.stringify(uploadData)}`);
  }

  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

/**
 * Los videos suben en estado PROCESSING y hay que esperar a ACTIVE antes
 * de poder referenciarlos en generateContent. Para un clip de máximo 8s
 * esto es cuestión de segundos — acotamos el polling para no dejar la
 * Edge Function esperando indefinidamente si algo sale mal del lado de
 * Gemini.
 */
async function waitForGeminiFileActive(apiKey: string, name: string, scanId: string): Promise<void> {
  const maxAttempts = 20;
  const delayMs = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${GEMINI_API_BASE}/${name}?key=${apiKey}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini Files API (status) error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (data.state === 'ACTIVE') return;
    if (data.state === 'FAILED') {
      throw new Error(`Gemini no pudo procesar el video: ${JSON.stringify(data.error ?? {})}`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Timeout esperando a que Gemini termine de procesar el video');
}

/** Sube el video y espera a que quede listo para usarse en analyzeVideo(). */
export async function prepareGeminiVideoFile(params: {
  apiKey: string;
  body: BodyInit;
  sizeBytes: number;
  mimeType: string;
  scanId: string;
}): Promise<UploadedGeminiFile> {
  const file = await uploadVideoToGeminiFiles(params);
  await waitForGeminiFileActive(params.apiKey, file.name, params.scanId);
  return file;
}

/**
 * Borra el archivo subido a Gemini Files. Best-effort: Gemini los expira
 * solo a las 48h de todos modos, así que un fallo acá nunca debe romper
 * ni demorar el flujo del scan — el caller solo debe loguearlo.
 */
export async function deleteGeminiFile(apiKey: string, name: string, scanId: string): Promise<void> {
  const response = await fetch(`${GEMINI_API_BASE}/${name}?key=${apiKey}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Gemini Files API (delete) error ${response.status}: ${await response.text()}`);
  }
}

/** Validación defensiva — nunca confiar ciegamente en la salida de un LLM. */
function validateGeminiResult(result: GeminiResult): void {
  const clampField = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

  if (!result.scores || !result.signals || !result.moderation) {
    throw new Error('Respuesta de Gemini con forma inválida');
  }

  result.scores.confidence = clampField(result.scores.confidence);
  result.scores.style = clampField(result.scores.style);
  result.scores.timing = clampField(result.scores.timing);
  result.scores.cringeRisk = clampField(result.scores.cringeRisk);

  result.moments = (result.moments ?? []).slice(0, 6).filter(
    (m) =>
      (m.polarity === 'positive' || m.polarity === 'negative') &&
      [1, 2, 3].includes(m.intensity),
  );
}
