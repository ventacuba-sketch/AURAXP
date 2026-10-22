/**
 * Prompt + schema para el análisis de video con Gemini.
 *
 * Contrato: Gemini SOLO devuelve señales/lecturas observables (0-100 por
 * eje, momentos ordinales 1-3). Nunca ve ni produce Aura Score ni XP —
 * eso lo calcula exclusivamente scoring.ts en el backend.
 */

import type { GeminiResult } from './scoring.ts';

const GEMINI_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

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

Además, reportá en observedDurationSec la duración aproximada real del
clip en segundos (tu propia lectura del archivo, no un dato que te
pasen) -- es un chequeo de integridad, no afecta tu análisis de aura.

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
      required: ['hasClearAction', 'actionType', 'personCount', 'brokeImmersion', 'hesitationDetected', 'faceVisible'],
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
    verdict: { type: 'OBJECT', properties: { headline: { type: 'STRING' } }, required: ['headline'] },
    moderation: {
      type: 'OBJECT',
      properties: { flagged: { type: 'BOOLEAN' }, reason: { type: 'STRING', nullable: true } },
      required: ['flagged', 'reason'],
    },
    modelConfidence: { type: 'NUMBER' },
    observedDurationSec: { type: 'NUMBER' },
  },
  required: ['signals', 'scores', 'moments', 'verdict', 'moderation', 'modelConfidence', 'observedDurationSec'],
};

interface AnalyzeVideoParams {
  apiKey: string;
  fileUri: string;
  mimeType: string;
  scanId: string;
  usageHolder?: { value?: unknown };
  mediaResolution?: string;
}

class GeminiHttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(status: number, body: string, retryAfterMs: number | null = null) {
    super(`Gemini API error ${status}: ${body}`);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

// Google recomienda reintentar errores transitorios (408, 429 y 5xx) con
// exponential backoff + jitter. Cinco intentos mantienen la espera acotada
// pero dan una oportunidad adicional durante picos cortos de capacidad.
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(MAX_RETRY_DELAY_MS, Math.max(250, retryAfterMs));
  const cap = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
  // Full jitter: distribuye reintentos concurrentes dentro de la ventana.
  return Math.max(250, Math.round(Math.random() * cap));
}

async function callGeminiOnce({ apiKey, fileUri, mimeType, scanId, usageHolder, mediaResolution }: AnalyzeVideoParams, model = GEMINI_MODEL): Promise<GeminiResult> {
  const response = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT }, { fileData: { fileUri, mimeType } }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        ...(mediaResolution ? { mediaResolution } : {}),
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new GeminiHttpError(response.status, errText, parseRetryAfterMs(response.headers.get('retry-after')));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvió contenido');

  if (data?.usageMetadata) {
    logAttempt('usage', { scanId, usage: data.usageMetadata });
    if (usageHolder) usageHolder.value = data.usageMetadata;
  }

  const parsed = JSON.parse(text) as GeminiResult;
  validateGeminiResult(parsed);
  return parsed;
}

function logAttempt(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ src: 'analyzeVideo', event, ...data }));
}

export async function analyzeVideo(params: AnalyzeVideoParams): Promise<GeminiResult> {
  const { scanId } = params;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    logAttempt('attempt_start', { scanId, attempt, maxAttempts: MAX_ATTEMPTS });
    try {
      const result = await callGeminiOnce(params, GEMINI_MODEL);
      if (attempt > 1) logAttempt('attempt_succeeded_after_retry', { scanId, attempt });
      return result;
    } catch (e) {
      const status = e instanceof GeminiHttpError ? e.status : null;
      const retryable = e instanceof GeminiHttpError && RETRYABLE_STATUSES.has(e.status);
      if (!retryable) {
        logAttempt('non_retryable_error', {
          scanId,
          attempt,
          status,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }

      if (attempt === MAX_ATTEMPTS) {
        logAttempt('final_failure', { scanId, attempt, status });
        try {
          logAttempt('fallback_start', { scanId, model: FALLBACK_MODEL });
          return await callGeminiOnce(params, FALLBACK_MODEL);
        } catch (fallbackError) {
          logAttempt('fallback_failed', { scanId, model: FALLBACK_MODEL, message: String(fallbackError).slice(0, 200) });
          throw new GeminiUnavailableError('Both Gemini models unavailable');
        }
      }

      const delayMs = retryDelayMs(attempt, e.retryAfterMs);
      logAttempt('retrying', { scanId, attempt, status, delayMs, retryAfterMs: e.retryAfterMs });
      await sleep(delayMs);
    }
  }
  throw new Error('analyzeVideo: estado inesperado');
}

interface UploadedGeminiFile {
  uri: string;
  mimeType: string;
  name: string;
}

async function uploadVideoToGeminiFiles({ apiKey, body, sizeBytes, mimeType, scanId }: {
  apiKey: string;
  body: BodyInit;
  sizeBytes: number;
  mimeType: string;
  scanId: string;
}): Promise<UploadedGeminiFile> {
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

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body,
    duplex: 'half',
  } as RequestInit);

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text();
    throw new Error(`Gemini Files API (upload) error ${uploadResponse.status}: ${errorBody}`);
  }

  const uploadData = await uploadResponse.json();
  const file = uploadData?.file ?? (uploadData?.name ? uploadData : null);
  if (!file?.uri || !file?.name) {
    throw new Error(`Gemini Files API no devolvió el archivo subido: ${JSON.stringify(uploadData)}`);
  }
  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

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
    if (data.state === 'FAILED') throw new Error(`Gemini no pudo procesar el video: ${JSON.stringify(data.error ?? {})}`);
    await sleep(delayMs);
  }

  throw new Error('Timeout esperando a que Gemini termine de procesar el video');
}

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

export async function deleteGeminiFile(apiKey: string, name: string, scanId: string): Promise<void> {
  const response = await fetch(`${GEMINI_API_BASE}/${name}?key=${apiKey}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Gemini Files API (delete) error ${response.status}: ${await response.text()}`);
}

function validateGeminiResult(result: GeminiResult): void {
  const clampField = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
  if (!result.scores || !result.signals || !result.moderation) throw new Error('Respuesta de Gemini con forma inválida');

  result.scores.confidence = clampField(result.scores.confidence);
  result.scores.style = clampField(result.scores.style);
  result.scores.timing = clampField(result.scores.timing);
  result.scores.cringeRisk = clampField(result.scores.cringeRisk);
  result.moments = (result.moments ?? []).slice(0, 6).filter(
    (m) => (m.polarity === 'positive' || m.polarity === 'negative') && [1, 2, 3].includes(m.intensity),
  );
  result.observedDurationSec =
    typeof result.observedDurationSec === 'number' && Number.isFinite(result.observedDurationSec) && result.observedDurationSec > 0
      ? result.observedDurationSec
      : 0;
}
