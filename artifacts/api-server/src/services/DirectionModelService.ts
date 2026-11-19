/**
 * DirectionModelService
 *
 * Answers a different question from EntryConfidenceService:
 *
 *   EntryConfidenceService → "is this a good place to enter?"
 *   DirectionModelService  → "which way is price more likely to move next?"
 *
 * The direction forecast is a small logistic model, not another hand-weighted
 * score. It predicts the probability that price reaches +1 ATR before -1 ATR
 * within the model's horizon (currently 20 M15 bars = 5 hours), using only
 * information that is already closed at the signal bar.
 *
 * Why a separate model instead of reusing the confluence score: the confluence
 * score was fitted to rank setup quality for a limit-entry replay. It was never
 * fitted to predict direction, and its factors (value zone, RR) describe the
 * entry plan rather than the next move. Mixing the two would make neither
 * honest.
 *
 * The score is the model's own probability, so it is calibrated by construction:
 * a score of 62 means "historically, setups in this bucket moved in the stated
 * direction about 62% of the time", not "62 out of 100 points". How strong that
 * evidence is comes from `validation` and `caveat`, which the CLI writes after
 * one holdout read; the service never invents or smooths those numbers.
 */

import type { Candle } from "./TwelveDataService.js";
import { calcATR, calcEMA } from "./TwelveDataService.js";
import type { TrendData } from "./MarketStructureService.js";
import { DIRECTION_MODEL } from "./DirectionModelCoefficients.js";

export const DIRECTION_FEATURE_NAMES = [
  "h1EmaSpread",
  "h1EmaSlope",
  "h1Dmi",
  "h1Adx",
  "h1Structure",
  "h1Rsi",
  "m15EmaSpread",
  "m15EmaSlope",
  "m15Dmi",
  "m15Adx",
  "m15Structure",
  "m15Rsi",
  "m15Momentum",
  "m15DistEma",
] as const;

export type DirectionFeatureName = (typeof DIRECTION_FEATURE_NAMES)[number];
export type DirectionFeatureVector = number[];

const FEATURE_LABELS: Record<DirectionFeatureName, string> = {
  h1EmaSpread: "EMA20/50 H1",
  h1EmaSlope: "Slope EMA H1",
  h1Dmi: "DMI H1",
  h1Adx: "ADX H1",
  h1Structure: "Struktur H1",
  h1Rsi: "RSI H1",
  m15EmaSpread: "EMA20/50 M15",
  m15EmaSlope: "Slope EMA M15",
  m15Dmi: "DMI M15",
  m15Adx: "ADX M15",
  m15Structure: "Struktur M15",
  m15Rsi: "RSI M15",
  m15Momentum: "Momentum 1 jam",
  m15DistEma: "Jarak ke EMA21",
};

export type DirectionStrength = "Kuat" | "Sedang" | "Lemah";

export interface DirectionFactor {
  label: string;
  /** Standardised feature value (z-score) used by the model. */
  value: number;
  /** Signed log-odds contribution: positive pushes BUY, negative pushes SELL. */
  contribution: number;
}

export interface DirectionForecast {
  direction: "BUY" | "SELL";
  /** 50–100. The model's probability for `direction`, in percent. */
  score: number;
  strength: DirectionStrength;
  probabilityUp: number;
  baseRateUp: number;
  /** Probability of the stated direction minus the base rate of that side. */
  edge: number;
  horizonBars: number;
  horizonHours: number;
  /** Contributions sorted by absolute impact, strongest first. */
  factors: DirectionFactor[];
  /** Historical hit rate of this score bucket on non-overlapping rows. */
  calibration?: { bucket: string; samples: number; accuracy: number };
  validation: { from: string; to: string; samples: number; accuracy: number; auc: number };
  model: string;
  trainedThrough: string;
  note: string;
}

function clampFeature(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-5, Math.min(5, value));
}

function slopeAtr(series: number[], atr: number, lookback = 5): number {
  const n = series.length;
  if (n <= lookback || atr <= 0) return 0;
  return (series[n - 1] - series[n - 1 - lookback]) / atr;
}

function structureValue(trend: TrendData): number {
  if (trend.structure === "HH-HL") return 1;
  if (trend.structure === "LH-LL") return -1;
  return 0;
}

/**
 * Build the feature vector from closed candles only.
 *
 * `h1History` must end at the newest H1 candle that has already closed at or
 * before the M15 signal bar. Passing a still-forming H1 candle would leak
 * future information into the forecast.
 */
export function extractDirectionFeatures(
  h1History: Candle[],
  m15History: Candle[],
  h1Trend: TrendData,
  m15Trend: TrendData,
): DirectionFeatureVector {
  if (h1History.length < 60 || m15History.length < 60) {
    throw new Error("Need at least 60 closed candles per timeframe for direction features");
  }

  const h1Atr = calcATR(h1History, 14);
  const h1EmaFast = calcEMA(h1History, 20);
  const h1EmaSlow = calcEMA(h1History, 50);

  const m15Atr = calcATR(m15History, 14);
  const m15EmaFast = calcEMA(m15History, 20);
  const m15EmaSlow = calcEMA(m15History, 50);
  const m15Ema21 = calcEMA(m15History, 21);

  const n = m15History.length;
  const last = m15History[n - 1];
  const m15Spread = m15Atr > 0 ? (m15EmaFast[n - 1] - m15EmaSlow[n - 1]) / m15Atr : 0;
  const m15Dist = m15Atr > 0 ? (last.close - m15Ema21[n - 1]) / m15Atr : 0;
  const m15Mom = n > 5 && m15Atr > 0 ? (last.close - m15History[n - 5].close) / m15Atr : 0;
  const h1Spread = h1Atr > 0
    ? (h1EmaFast[h1History.length - 1] - h1EmaSlow[h1History.length - 1]) / h1Atr
    : 0;

  return [
    clampFeature(h1Spread),
    clampFeature(slopeAtr(h1EmaFast, h1Atr)),
    clampFeature((h1Trend.diPlus - h1Trend.diMinus) / 50),
    clampFeature(h1Trend.adx / 50),
    structureValue(h1Trend),
    clampFeature((h1Trend.rsi - 50) / 50),
    clampFeature(m15Spread),
    clampFeature(slopeAtr(m15EmaFast, m15Atr)),
    clampFeature((m15Trend.diPlus - m15Trend.diMinus) / 50),
    clampFeature(m15Trend.adx / 50),
    structureValue(m15Trend),
    clampFeature((m15Trend.rsi - 50) / 50),
    clampFeature(m15Mom),
    clampFeature(m15Dist),
  ];
}

export function sigmoid(value: number): number {
  if (value >= 0) {
    const e = Math.exp(-value);
    return 1 / (1 + e);
  }
  const e = Math.exp(value);
  return e / (1 + e);
}

/** The model stores the subset of feature names it was fitted on. */
function usedFeatureIndex(name: string): number {
  return DIRECTION_FEATURE_NAMES.indexOf(name as DirectionFeatureName);
}

export function predictProbabilityUp(features: DirectionFeatureVector): number {
  const { intercept, weights, means, stds } = DIRECTION_MODEL;
  let z = intercept;
  DIRECTION_MODEL.features.forEach((name, k) => {
    const index = usedFeatureIndex(name);
    if (index < 0) return;
    const std = stds[k] || 1;
    z += weights[k] * ((features[index] - means[k]) / std);
  });
  return sigmoid(z);
}

export function strengthOf(score: number): DirectionStrength {
  if (score >= DIRECTION_MODEL.strongCutoff) return "Kuat";
  if (score >= DIRECTION_MODEL.mediumCutoff) return "Sedang";
  return "Lemah";
}

/**
 * Turn the probability into a display forecast.
 *
 * The horizon comes from the fitted model (currently 5 hours, which fits inside
 * a 17:00–00:00 WIB session). It is a prediction horizon, not a take-profit: TP
 * and SL stay the trader's decision.
 */
export function scoreDirection(
  h1History: Candle[],
  m15History: Candle[],
  h1Trend: TrendData,
  m15Trend: TrendData,
): DirectionForecast {
  if (DIRECTION_MODEL.features.length !== DIRECTION_MODEL.weights.length) {
    throw new Error("Direction model coefficients are missing or stale; re-run backtest:direction");
  }

  const features = extractDirectionFeatures(h1History, m15History, h1Trend, m15Trend);
  const probabilityUp = predictProbabilityUp(features);
  const direction = probabilityUp >= 0.5 ? "BUY" : "SELL";
  const probabilityForDirection = direction === "BUY" ? probabilityUp : 1 - probabilityUp;
  const score = Math.round(probabilityForDirection * 100);
  const baseRateUp = DIRECTION_MODEL.baseRateUp;
  const baseForDirection = direction === "BUY" ? baseRateUp : 1 - baseRateUp;
  const edge = probabilityForDirection - baseForDirection;

  const factors: DirectionFactor[] = DIRECTION_MODEL.features.map((name, k) => {
    const index = usedFeatureIndex(name);
    const std = DIRECTION_MODEL.stds[k] || 1;
    const z = index >= 0 ? (features[index] - DIRECTION_MODEL.means[k]) / std : 0;
    return {
      label: FEATURE_LABELS[name as DirectionFeatureName] ?? name,
      value: Number(z.toFixed(2)),
      contribution: Number((DIRECTION_MODEL.weights[k] * z).toFixed(2)),
    };
  }).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const top = factors.slice(0, 3)
    .map((factor) => `${factor.label} ${factor.contribution >= 0 ? "mendorong BUY" : "mendorong SELL"} (${factor.contribution >= 0 ? "+" : ""}${factor.contribution})`)
    .join("; ");

  const horizonHours = DIRECTION_MODEL.horizonBars / 4;
  const strength = strengthOf(score);
  const bucket = DIRECTION_MODEL.calibrationBuckets.find(
    (entry) => score >= entry.low && score <= entry.high,
  );

  const note = [
    `Prediksi arah ${horizonHours} jam ke depan: ${direction} dengan skor ${score}/100.`,
    `Ini probabilitas model historis, bukan kepastian: ${score} berarti sekitar ${score}% setup serupa bergerak ke arah ${direction} lebih dulu.`,
    bucket
      ? `Bucket skor ini benar ${(bucket.accuracy * 100).toFixed(0)}% pada ${bucket.samples} sampel validasi non-overlap.`
      : "",
    DIRECTION_MODEL.mediumCutoff === 101
      ? "Tidak ada bucket skor yang mengalahkan base rate saat validasi, jadi skor ini belum punya edge yang terbukti."
      : `Di bawah skor ${DIRECTION_MODEL.mediumCutoff} tidak ada edge yang terbukti.`,
    top ? `Pendorong utama: ${top}.` : "",
    DIRECTION_MODEL.caveat,
  ].filter(Boolean).join(" ");

  return {
    direction,
    score,
    strength,
    probabilityUp: Number(probabilityUp.toFixed(4)),
    baseRateUp: Number(baseRateUp.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    horizonBars: DIRECTION_MODEL.horizonBars,
    horizonHours,
    factors,
    ...(bucket
      ? { calibration: { bucket: `${bucket.low}-${bucket.high}`, samples: bucket.samples, accuracy: bucket.accuracy } }
      : {}),
    validation: DIRECTION_MODEL.validation,
    model: DIRECTION_MODEL.version,
    trainedThrough: DIRECTION_MODEL.trainedThrough,
    note,
  };
}
