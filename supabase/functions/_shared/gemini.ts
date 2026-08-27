/**
 * Prompt + schema para el análisis de video con Gemini.
 *
 * Contrato: Gemini SOLO devuelve señales/lecturas observables (0-100 por
 * eje, momentos ordinales 1-3). Nunca ve ni produce Aura Score ni XP —
 * eso lo calcula exclusivamente scoring.ts en el backend.
 */

import type { GeminiResult } from './scoring.ts';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
  videoBase64: string;
  mimeType: string;
}

/** Llama a Gemini con el video inline y fuerza el JSON del contrato. */
export async function analyzeVideo({
  apiKey,
  videoBase64,
  mimeType,
}: AnalyzeVideoParams): Promise<GeminiResult> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            { inlineData: { mimeType, data: videoBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvió contenido');

  const parsed = JSON.parse(text) as GeminiResult;
  validateGeminiResult(parsed);
  return parsed;
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
