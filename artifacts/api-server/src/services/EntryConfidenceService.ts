/**
 * EntryConfidenceService
 *
 * Calculates a heuristic confluence score (0–100), not a win probability.
 *
 * Every factor is advisory: it can lower the score and add context, but cannot
 * prevent the app from returning a directional setup.
 *
 * The score is a pure sum of per-factor points:
 *
 *   points_i = round(weight_i × credit_i × 100)
 *   score    = Σ points_i
 *
 * `credit` is a 0–1 partial-credit value instead of a binary pass/fail, so a
 * factor that is only partly satisfied still contributes part of its weight.
 * The rounded points are what the dashboard displays, which means the score can
 * be reconciled by adding the visible item points together.
 */

import type { Candle } from "./TwelveDataService.js";
import {
  calcATR,
  calcEMA,
  findSwingHighPoints,
  findSwingLowPoints,
} from "./TwelveDataService.js";
import type { TrendData, TrendDirection } from "./MarketStructureService.js";
import type { NewsRisk } from "./NewsService.js";

export interface ChecklistItem {
  label: string;
  passed: boolean;
  weight: number;
  /** 0–1 partial credit earned for this factor. */
  credit: number;
  /** Rounded points this factor contributes to the score. */
  points: number;
}

export type ConfidenceLevel = "High" | "Medium" | "Low" | "VeryLow";

/**
 * Band cutoffs, fitted on the calibration split and checked unchanged on the
 * chronological holdout. Exported because the setup advisory reuses the top
 * cutoff instead of hard-coding a second threshold.
 */
export const SCORE_CUTOFFS = [35, 45, 55] as const;

/**
 * Scoring weights for the no-cap, additive, partial-credit score.
 *
 * Fitted on the calibration split only and then checked once on the
 * chronological holdout. Swing structure and momentum carry weight 0: neither
 * kept the same sign across the two splits, so they stay in the checklist as
 * visible context but must not move the score.
 *
 * News also carries weight 0. The replay only has a news-neutral scenario, so
 * the old 0.10 news weight added a constant 10 points to every historical trade
 * — zero discriminating power — while adding unvalidated variance live.
 * Headline risk is still surfaced as an advisory.
 *
 * The remaining weights sum to 1, so a perfect setup still reaches 100.
 */
export const SCORING_WEIGHTS = {
  alignment: 0.16,
  structure: 0,
  dmi: 0.24,
  valueZone: 0.22,
  confirmation: 0.05,
  momentum: 0,
  entryFreshness: 0.14,
  rewardRisk: 0.19,
  news: 0,
} as const;

export interface ConfidenceMetrics {
  /** M15 RSI used by the entry-freshness factor. */
  rsiM15: number;
  /** Distance from the M15 EMA21 in ATR units (extension proxy). */
  distanceEmaAtr: number;
  /** Distance from the value-zone anchor in ATR units. */
  valueZoneDistanceAtr: number;
  /** Bars since price last traded within 0.5 ATR of the M15 EMA21. */
  barsSincePullback: number;
  /** Lower of the two ADX readings. */
  adxMin: number;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  /** Critical-gap warnings. They never change the score. */
  advisories: string[];
  checklist: ChecklistItem[];
  timeframeAligned: boolean;
  tradeAllowed: boolean;
  note: string;
  /** Diagnostics for the backtest export; not returned by the live API. */
  metrics: ConfidenceMetrics;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ─── Individual condition checks ──────────────────────────────────────────────

/**
 * Alignment credit.
 *
 * 1.0 when both timeframes trend in the same direction, 0.5 when they agree on
 * direction but at least one is still transitioning, 0.2 when one is ranging,
 * and 0 when they disagree.
 */
function evaluateAlignment(h1: TrendData, m15: TrendData): number {
  if (h1.direction !== m15.direction) return 0;
  const states = [h1.marketState, m15.marketState];
  if (states.some((state) => state === "RANGING")) return 0.2;
  if (states.every((state) => state === "TRENDING")) return 1;
  return 0.5;
}

/**
 * DMI + ADX credit.
 *
 * Full credit needs directional agreement on both timeframes, ADX >= 25 on
 * both, and a non-falling ADX slope. ADX 20–25 keeps 70% of the weight, and a
 * falling slope halves whatever is left. Directional conflict or ADX below 20
 * earns nothing.
 */
function evaluateDmi(h1: TrendData, m15: TrendData, bias: TrendDirection): number {
  const diAligned = bias === "BUY"
    ? h1.diPlus > h1.diMinus && m15.diPlus > m15.diMinus
    : h1.diMinus > h1.diPlus && m15.diMinus > m15.diPlus;
  const adxMin = Math.min(h1.adx, m15.adx);
  if (!diAligned || adxMin < 20) return 0;

  let credit = adxMin >= 25 ? 1 : 0.7;
  const slopeOk = h1.adxSlope > -3 && m15.adxSlope > -3;
  if (!slopeOk) credit *= 0.5;
  return credit;
}

/**
 * Value-zone credit.
 *
 * The gap between price and the nearest valid anchor (EMA21, or the most recent
 * confirmed swing) is measured in ATR. Up to 0.5 ATR earns full credit, the
 * 0.5–1.0 ATR band tapers to 0.6, and beyond 1 ATR the factor earns nothing.
 * This keeps the old 1-ATR pass boundary but stops treating "0.9 ATR away" and
 * "on the level" as identical setups.
 */
function evaluateValueZone(
  candles: Candle[],
  direction: TrendDirection,
  atr: number,
): { credit: number; distanceAtr: number } {
  const n = candles.length;
  const current = candles[n - 1].close;
  const ema21 = calcEMA(candles, 21)[n - 1] ?? current;

  const maxSwingAge = 24;
  const swings = direction === "BUY"
    ? findSwingLowPoints(candles, 2, atr, 0.3)
      .filter((point) => n - 1 - point.index <= maxSwingAge)
      .map((point) => point.price)
    : findSwingHighPoints(candles, 2, atr, 0.3)
      .filter((point) => n - 1 - point.index <= maxSwingAge)
      .map((point) => point.price);

  const anchors = [ema21, ...(swings.length ? [swings[swings.length - 1]] : [])];
  let distanceAtr = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const gap = direction === "BUY" ? current - anchor : anchor - current;
    // Price must sit on the correct side of the anchor; otherwise the level is
    // overhead resistance / support below, not a value zone.
    if (gap >= 0) distanceAtr = Math.min(distanceAtr, atr > 0 ? gap / atr : Infinity);
  }
  if (!Number.isFinite(distanceAtr)) return { credit: 0, distanceAtr: 99 };

  const credit = distanceAtr <= 0.5
    ? 1
    : distanceAtr <= 1
      ? 1 - (0.4 * (distanceAtr - 0.5)) / 0.5
      : 0;
  return { credit: clamp01(credit), distanceAtr };
}

/**
 * Confirmation-candle credit: 1 for a strong directional body closing near the
 * extreme, 0.5 for a directional body of at least 25% of range, 0 otherwise.
 */
function evaluateConfirmation(
  candles: Candle[],
  direction: TrendDirection,
): { credit: number; strong: boolean } {
  if (candles.length < 2) return { credit: 0, strong: false };
  const recent = candles.slice(-2);
  const stats = recent.map((candle) => {
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    return {
      directional: direction === "BUY" ? candle.close > candle.open : candle.close < candle.open,
      bodyRatio: Math.abs(candle.close - candle.open) / range,
      closeNearExtreme: direction === "BUY"
        ? (candle.high - candle.close) / range <= 0.25
        : (candle.close - candle.low) / range <= 0.25,
    };
  });
  const strong = stats.some((s) => s.directional && s.bodyRatio >= 0.45 && s.closeNearExtreme);
  if (strong) return { credit: 1, strong: true };
  const weak = stats.some((s) => s.directional && s.bodyRatio >= 0.25);
  return { credit: weak ? 0.5 : 0, strong: false };
}

/**
 * Condition — Momentum Candle.
 * Any of last 5 closed candles has a strong body (≥55% of range) in the trend direction.
 */
function checkMomentumCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 3) return false;
  const recent = candles.slice(-5);
  return recent.some((c) => {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return false;
    const strongBody = body / range >= 0.55;
    const correctDir = direction === "BUY" ? c.close > c.open : c.close < c.open;
    return strongBody && correctDir;
  });
}

function checkHealthyMomentum(candles: Candle[], direction: TrendDirection, atr: number): boolean {
  if (candles.length < 4 || atr <= 0) return false;
  const recent = candles.slice(-3);
  const directionalCloses = recent.filter((c) => direction === "BUY" ? c.close > c.open : c.close < c.open).length;
  const averageRange = recent.reduce((sum, candle) => sum + candle.high - candle.low, 0) / recent.length;
  const last = candles.at(-1)!;
  const lastBody = Math.abs(last.close - last.open);
  return directionalCloses >= 2 && averageRange <= atr * 1.8 && lastBody / Math.max(last.high - last.low, Number.EPSILON) >= 0.35;
}

/**
 * Entry-freshness credit (anti-late-entry).
 *
 * Two independent extension proxies, both normalised to 0–1:
 *   - bars since price last traded within 0.5 ATR of the M15 EMA21 (time since
 *     the last pause): full credit at 0 bars, zero at 24 bars.
 *   - RSI extremity: full credit at RSI <= 65 (BUY) / >= 35 (SELL), zero at
 *     RSI >= 78 / <= 22.
 *
 * credit = 0.6 × barsCredit + 0.4 × rsiCredit (constants fixed before fitting).
 */
function evaluateEntryFreshness(
  candles: Candle[],
  direction: TrendDirection,
  atr: number,
  rsi: number,
): { credit: number; barsSincePullback: number; distanceEmaAtr: number } {
  const ema21 = calcEMA(candles, 21);
  const n = candles.length;
  const current = candles[n - 1].close;
  const emaNow = ema21[n - 1] ?? current;
  const distanceEmaAtr = atr > 0 ? Math.abs(current - emaNow) / atr : 99;

  const lookback = Math.min(48, n - 1);
  let barsSincePullback = lookback;
  for (let k = 1; k <= lookback; k++) {
    const index = n - k;
    if (index < 0) break;
    const gap = atr > 0 ? Math.abs(candles[index].close - (ema21[index] ?? current)) / atr : 99;
    if (gap <= 0.5) {
      barsSincePullback = k - 1;
      break;
    }
  }

  const barsCredit = clamp01(1 - barsSincePullback / 24);
  const rsiCredit = direction === "BUY"
    ? clamp01((78 - rsi) / 13)
    : clamp01((rsi - 22) / 13);
  return {
    credit: 0.6 * barsCredit + 0.4 * rsiCredit,
    barsSincePullback,
    distanceEmaAtr,
  };
}

export function scoreToLevel(score: number): ConfidenceLevel {
  // Cutoffs are data-driven: fitted on the calibration split, then checked on
  // the chronological holdout. 35/45/55 was the configuration that stayed
  // monotonic in both splits and kept the top band positive on every pair.
  // Re-validate whenever the weights or the sample window change.
  const [low, medium, high] = SCORE_CUTOFFS;
  if (score >= high) return "High";
  if (score >= medium) return "Medium";
  if (score >= low) return "Low";
  return "VeryLow";
}

export interface CriticalScoreFlags {
  timeframeAligned: boolean;
  confirmationCandle: boolean;
  riskRewardRatio: number;
  newsStatus: NewsRisk["status"];
}

/**
 * The score is purely additive: the sum of the per-factor points. It is never
 * clamped to a ceiling, because clamping made the displayed score weaker than
 * the checklist justified and hid genuinely good setups behind a number the
 * user could not reconcile with the factors.
 *
 * Critical gaps are still detected, but only as warnings. They explain the risk
 * next to the score and they feed the setup advisory (an RR below 1 still marks
 * the setup WAIT), without rewriting the score itself.
 */
export function applyScoreAdvisories(
  baseScore: number,
  flags: CriticalScoreFlags,
): { score: number; advisories: string[] } {
  const advisories: string[] = [];

  if (!flags.timeframeAligned) advisories.push("H1/M15 belum selaras");
  if (!flags.confirmationCandle) advisories.push("belum ada candle konfirmasi");
  if (flags.riskRewardRatio < 0.5) advisories.push("RR di bawah 0.5");
  else if (flags.riskRewardRatio < 1) advisories.push("RR di bawah 1");
  else if (flags.riskRewardRatio < 2) advisories.push("RR di bawah 2");
  if (flags.newsStatus === "HIGH_RISK") advisories.push("risiko berita tinggi");
  else if (flags.newsStatus === "UNAVAILABLE") {
    // A provider outage is missing information, not evidence of risk.
    advisories.push("data berita tidak tersedia (bobot berita 0, hanya info)");
  }

  return {
    score: Math.max(0, Math.min(100, baseScore)),
    advisories,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

interface RawFactor {
  label: string;
  weight: number;
  credit: number;
}

export function calculateConfidence(
  pair: string,
  h1Trend: TrendData,
  m15Trend: TrendData,
  candles: Candle[],
  plannedRiskReward: number,
  newsRisk: NewsRisk,
): ConfidenceResult {
  const bias = h1Trend.direction;
  const atr = calcATR(candles, 14);
  // Strict alignment stays a separate boolean because the advisory and the
  // setup status use it. The factor itself earns graded credit.
  const timeframeAligned =
    h1Trend.marketState === "TRENDING" &&
    m15Trend.marketState === "TRENDING" &&
    h1Trend.direction === m15Trend.direction;
  const structureAligned =
    h1Trend.structure === (bias === "BUY" ? "HH-HL" : "LH-LL") &&
    m15Trend.structure === (bias === "BUY" ? "HH-HL" : "LH-LL");

  const alignmentCredit = evaluateAlignment(h1Trend, m15Trend);
  const dmiCredit = evaluateDmi(h1Trend, m15Trend, bias);
  const valueZone = evaluateValueZone(candles, bias, atr);
  const confirmation = evaluateConfirmation(candles, bias);
  const freshness = evaluateEntryFreshness(candles, bias, atr, m15Trend.rsi);
  const momentumPassed =
    checkHealthyMomentum(candles, bias, atr) && checkMomentumCandle(candles, bias);
  const rrCredit = clamp01(plannedRiskReward / 3);
  const newsCredit = 1 - Math.max(0, Math.min(100, newsRisk.riskScore)) / 100;

  const factors: RawFactor[] = [
    { label: "Alignment H1/M15", weight: SCORING_WEIGHTS.alignment, credit: alignmentCredit },
    { label: "Struktur HH-HL/LH-LL", weight: SCORING_WEIGHTS.structure, credit: structureAligned ? 1 : 0 },
    { label: "DMI + ADX Mendukung", weight: SCORING_WEIGHTS.dmi, credit: dmiCredit },
    { label: "Harga di Value Zone", weight: SCORING_WEIGHTS.valueZone, credit: valueZone.credit },
    { label: "Confirmation Candle", weight: SCORING_WEIGHTS.confirmation, credit: confirmation.credit },
    { label: "Momentum Sehat", weight: SCORING_WEIGHTS.momentum, credit: momentumPassed ? 1 : 0 },
    { label: "Kesegaran Entry", weight: SCORING_WEIGHTS.entryFreshness, credit: freshness.credit },
    { label: "Risk Reward Bagus", weight: SCORING_WEIGHTS.rewardRisk, credit: rrCredit },
    { label: "Risiko Berita Rendah", weight: SCORING_WEIGHTS.news, credit: newsCredit },
  ];

  const checklist: ChecklistItem[] = factors.map((factor) => {
    // Round the credit first, then derive the points from that exact value, so
    // the exported/displayed breakdown always multiplies back to the points.
    const credit = Number(factor.credit.toFixed(3));
    return {
      label: factor.label,
      // `passed` drives the dashboard checkmark and the setup advisory. A factor
      // counts as passed once it earns at least half of its credit.
      passed: factor.credit >= 0.5,
      weight: factor.weight,
      credit,
      points: Math.round(factor.weight * credit * 100),
    };
  });

  // Score is the sum of the visible item points, so the dashboard number can be
  // reconciled by adding the list together. Weights sum to 1, so 100 remains
  // reachable.
  const baseScore = checklist.reduce((sum, item) => sum + item.points, 0);
  const { score, advisories } = applyScoreAdvisories(baseScore, {
    timeframeAligned,
    confirmationCandle: confirmation.strong,
    riskRewardRatio: plannedRiskReward,
    newsStatus: newsRisk.status,
  });
  const level = scoreToLevel(score);
  // Deprecated compatibility field: the score is advisory and never a hard gate.
  const tradeAllowed = true;

  const byLabel = new Map(checklist.map((item) => [item.label, item]));
  const warnings = [
    !timeframeAligned ? "arah/state H1-M15 belum selaras" : "",
    !structureAligned ? "struktur swing belum mendukung penuh" : "",
    !(byLabel.get("DMI + ADX Mendukung")?.passed ?? false) ? "DMI/ADX belum mendukung penuh" : "",
    valueZone.credit < 0.5 ? "harga belum dekat zona value" : "",
    !confirmation.strong ? "candle konfirmasi belum kuat" : "",
    freshness.credit < 0.5 ? "entry sudah jauh dari titik pullback terakhir" : "",
    plannedRiskReward < 1.5 ? "RR rencana di bawah 1:1.5" : "",
    newsRisk.status === "HIGH_RISK" ? `risiko berita tinggi: ${newsRisk.headline}` : "",
    newsRisk.status === "CAUTION" ? `risiko berita sedang: ${newsRisk.headline}` : "",
    newsRisk.status === "UNAVAILABLE" ? "data berita tidak lengkap; bobot berita 0" : "",
  ].filter(Boolean);

  const advisoryNote = advisories.length > 0
    ? ` Perhatian: ${advisories.join("; ")}.`
    : "";

  return {
    score,
    level,
    advisories,
    checklist,
    timeframeAligned,
    tradeAllowed,
    note: `Skor konfluensi ${pair}: ${score}/100 (heuristik, bukan probabilitas menang). Ini peringatan saja—sistem tidak memblokir setup.${advisoryNote}${warnings.length > 0 ? ` Perlu diperhatikan: ${warnings.join("; ")}.` : " Tidak ada peringatan utama; tetap kelola risiko."}`,
    metrics: {
      rsiM15: Number(m15Trend.rsi.toFixed(1)),
      distanceEmaAtr: Number(freshness.distanceEmaAtr.toFixed(2)),
      valueZoneDistanceAtr: Number(valueZone.distanceAtr.toFixed(2)),
      barsSincePullback: freshness.barsSincePullback,
      adxMin: Number(Math.min(h1Trend.adx, m15Trend.adx).toFixed(1)),
    },
  };
}
