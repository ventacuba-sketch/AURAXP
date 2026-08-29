/**
 * AURAXP Scoring v1 — CONGELADO.
 *
 * Fórmula determinística: Gemini entrega señales/lecturas observables
 * (0-100 por eje, momentos ordinales), este módulo decide el número.
 * Gemini nunca ve ni produce Aura Score ni XP.
 *
 * No cambiar pesos/tabla de puntos/tiers sin datos reales de producción
 * (acordado: primero probar con 30-50 videos).
 *
 * Módulo TypeScript puro (sin imports de Deno/Node) para poder
 * importarlo tanto desde el Edge Function como, más adelante, desde
 * un test unitario corriendo con cualquier runtime.
 */

export type Polarity = 'positive' | 'negative';
export type Intensity = 1 | 2 | 3;

export interface GeminiMoment {
  timestampSec: number;
  polarity: Polarity;
  label: string;
  intensity: Intensity;
}

export interface GeminiScores {
  confidence: number; // 0-100
  style: number; // 0-100
  timing: number; // 0-100
  cringeRisk: number; // 0-100, más alto = peor
}

export interface GeminiSignals {
  hasClearAction: boolean;
  actionType: string;
  personCount: number;
  brokeImmersion: boolean;
  hesitationDetected: boolean;
  faceVisible: boolean;
}

export interface GeminiResult {
  signals: GeminiSignals;
  scores: GeminiScores;
  moments: GeminiMoment[];
  verdict: { headline: string };
  moderation: { flagged: boolean; reason: string | null };
  modelConfidence: number;
}

export interface TimelineBeat {
  time: string; // "0:0X", formateado desde timestampSec
  delta: number;
  label: string;
}

export type Tier =
  | 'FLOP'
  | 'MEDIOCRE'
  | 'SOLIDO'
  | 'BUENO'
  | 'EXCELENTE'
  | 'CASI_LEGENDARIO'
  | 'LEGENDARIO'
  | 'MITICO';

export interface ScoringResult {
  auraScore: number;
  tier: Tier;
  verdictTag: string;
  beats: TimelineBeat[];
  cqi: number;
}

// ── Tabla fija de puntos por momento (no la decide Gemini) ──────────────
const POSITIVE_POINTS: Record<Intensity, number> = { 1: 500, 2: 1100, 3: 2000 };
const NEGATIVE_POINTS: Record<Intensity, number> = { 1: -300, 2: -700, 3: -1200 };

// ── Pesos del Índice de Calidad Compuesto (CQI) ──────────────────────────
const WEIGHT_CONFIDENCE = 0.35;
const WEIGHT_STYLE = 0.35;
const WEIGHT_TIMING = 0.15;
const WEIGHT_ANTI_CRINGE = 0.15;

// ── Clamp de seguridad ────────────────────────────────────────────────
const AURA_MIN = -8000;
const AURA_MAX = 12000;

// ── Tiers (recalibrados al techo de 12,000) ─────────────────────────────
const TIER_THRESHOLDS: Array<{ min: number; tier: Tier; label: string }> = [
  { min: 11200, tier: 'MITICO', label: 'MÍTICO' },
  { min: 10000, tier: 'LEGENDARIO', label: 'LEGENDARIO' },
  { min: 8500, tier: 'CASI_LEGENDARIO', label: 'CASI LEGENDARIO' },
  { min: 6000, tier: 'EXCELENTE', label: 'EXCELENTE' },
  { min: 3500, tier: 'BUENO', label: 'BUENO' },
  { min: 1500, tier: 'SOLIDO', label: 'SÓLIDO' },
  { min: 0, tier: 'MEDIOCRE', label: 'MEDIOCRE' },
  { min: -Infinity, tier: 'FLOP', label: 'FLOP' },
];

function tierFor(auraScore: number): { tier: Tier; label: string } {
  const match = TIER_THRESHOLDS.find((t) => auraScore >= t.min)!;
  return { tier: match.tier, label: match.label };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Calcula el Aura Score, tier y timeline a partir de una respuesta de
 * Gemini ya validada. No maneja el caso `hasClearAction=false` ni
 * `moderation.flagged` — esos son casos especiales que el caller
 * (process-scan) resuelve ANTES de llamar a esta función, porque no
 * pasan por la fórmula en absoluto.
 */
export function computeAuraScore(result: GeminiResult): ScoringResult {
  const { confidence, style, timing, cringeRisk } = result.scores;

  const cqi =
    (confidence * WEIGHT_CONFIDENCE +
      style * WEIGHT_STYLE +
      timing * WEIGHT_TIMING +
      (100 - cringeRisk) * WEIGHT_ANTI_CRINGE) /
    100;

  const multiplier = Math.pow(cqi, 3);
  const penaltyMultiplier = 1 + (1 - cqi) * 0.5;

  let positiveBeats = 0;
  let negativeBeats = 0;
  const beats: TimelineBeat[] = [];

  for (const moment of result.moments) {
    const points =
      moment.polarity === 'positive'
        ? POSITIVE_POINTS[moment.intensity]
        : NEGATIVE_POINTS[moment.intensity];

    if (moment.polarity === 'positive') positiveBeats += points;
    else negativeBeats += points;

    beats.push({
      time: formatTimestamp(moment.timestampSec),
      delta: points,
      label: moment.label,
    });
  }

  const rawScore = positiveBeats * multiplier + negativeBeats * penaltyMultiplier;
  const auraScore = clamp(Math.round(rawScore), AURA_MIN, AURA_MAX);
  const { tier, label } = tierFor(auraScore);

  return { auraScore, tier, verdictTag: label, beats, cqi };
}

/** El caso especial "no hay acción reconocible" — no pasa por la fórmula. */
export function noActionResult(): Pick<ScoringResult, 'auraScore' | 'tier' | 'verdictTag' | 'beats'> {
  return { auraScore: -50, tier: 'FLOP', verdictTag: 'FLOP', beats: [] };
}

// ── Economía de XP (independiente del Aura) ─────────────────────────────
export const XP_BASE_PER_SCAN = 50;

const XP_TIER_BONUS: Record<Tier, number> = {
  FLOP: 0,
  MEDIOCRE: 10,
  SOLIDO: 25,
  BUENO: 40,
  EXCELENTE: 60,
  CASI_LEGENDARIO: 90,
  LEGENDARIO: 130,
  MITICO: 200,
};

// El límite diario de Scans ya no es un número fijo -- depende del plan
// (FREE/PRO) y de la edad de la cuenta. Ver _shared/dailyLimit.ts
// (resolveDailyCap), la única fuente de verdad para eso.
export const DAILY_XP_SCAN_CAP = 5;

// ── XP de Challenge (independiente del XP de scan normal) ──────────────
// Deliberadamente chico frente a XP_BASE_PER_SCAN (50): cada participante
// de un Challenge ya cobró el XP de su propio scan por separado -- esto es
// un bonus adicional por competir, no un segundo pago del mismo scan. Los
// tres montos están pensados para no desbalancear la curva de niveles
// existente (xpForLevel de abajo, sin tocar).
export const CHALLENGE_PARTICIPATION_XP = 15;
export const CHALLENGE_WINNER_BONUS_XP = 40;
export const CHALLENGE_TIE_BONUS_XP = 20;

interface XpInput {
  tier: Tier;
  /** Contenido sin acción reconocible o rechazado por moderación → 0 XP, no consume el cupo diario. */
  countsForXp: boolean;
  /** Ya alcanzó el cupo diario de scans que otorgan XP. */
  dailyXpCapReached: boolean;
}

export function computeXpGained({ tier, countsForXp, dailyXpCapReached }: XpInput): number {
  if (!countsForXp) return 0;
  if (dailyXpCapReached) return 0;
  return XP_BASE_PER_SCAN + XP_TIER_BONUS[tier];
}

// ── Nivel — función pura de XP acumulado ────────────────────────────────
/** XP acumulado necesario para llegar al nivel n (incremento = 100 * nivel anterior). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += 100 * n;
  return total;
}

export function computeLevel(totalXp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  return level;
}
