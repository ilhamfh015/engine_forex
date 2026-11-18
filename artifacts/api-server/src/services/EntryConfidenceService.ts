/**
 * EntryConfidenceService
 *
 * Calculates a heuristic confluence score (0–100), not a win probability.
 *
 * Every factor is advisory: it can lower the score and add context, but cannot
 * prevent the app from returning a directional setup.
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
}

export type ConfidenceLevel = "High" | "Medium" | "Low" | "VeryLow";

/**
 * Scoring weights for the no-cap, purely additive score. Selected on the
 * calibration split and checked unchanged on the chronological holdout.
 *
 * Removing score caps changed the score distribution, so the capped-engine
 * weights no longer ordered the calibration bands monotonically. These weights
 * restore monotonic ordering in both splits (0-34/35-44/45-54/55-100) while
 * keeping the news weight at 0.10 and the High band positive on every pair in
 * the holdout.
 *
 * Swing structure and momentum carry weight 0 on purpose. Neither kept the same
 * sign across the two splits, so they stay in the checklist as visible context
 * but must not move the score.
 *
 * Value zone carries the largest share because it was the only factor with a
 * consistently positive lift across splits. Reward/risk is scored continuously
 * as RR/3 (capped at 1) so the planned distance-to-target moves the score
 * smoothly without any hard ceiling; an RR below 1 is still warned about and
 * marks the setup WAIT, but it never rewrites the score.
 */
export const SCORING_WEIGHTS = {
  alignment: 0.15,
  structure: 0,
  dmi: 0.22,
  valueZone: 0.30,
  confirmation: 0.06,
  momentum: 0,
  rewardRisk: 0.17,
  news: 0.10,
} as const;

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  /** Critical-gap warnings. They never change the score. */
  advisories: string[];
  checklist: ChecklistItem[];
  timeframeAligned: boolean;
  tradeAllowed: boolean;
  note: string;
}

// ─── Individual condition checks ──────────────────────────────────────────────

/**
 * Condition 1 — Price in value zone (near EMA21 or recent swing bounce).
 *
 * Swing proximity only counts for a recently confirmed pivot; stale swings
 * must not keep a value-zone condition passing indefinitely.
 */
function checkNearHLLH(
  candles: Candle[],
  direction: TrendDirection,
  atr: number,
): boolean {
  const n = candles.length;
  const current = candles[n - 1].close;
  const ema21arr = calcEMA(candles, 21);
  const ema21 = ema21arr[n - 1];

  const maxSwingAge = 24;
  const swingHighs = findSwingHighPoints(candles, 2, atr, 0.3)
    .filter((point) => n - 1 - point.index <= maxSwingAge);
  const swingLows = findSwingLowPoints(candles, 2, atr, 0.3)
    .filter((point) => n - 1 - point.index <= maxSwingAge);

  if (direction === "BUY") {
    // EMA21 proximity
    if (current >= ema21 && current - ema21 <= 1.0 * atr) return true;
    // Fresh swing low bounce
    if (swingLows.length > 0) {
      const lastLow = swingLows[swingLows.length - 1].price;
      if (current >= lastLow && current - lastLow <= 1.0 * atr) return true;
    }
  } else {
    // EMA21 proximity
    if (current <= ema21 && ema21 - current <= 1.0 * atr) return true;
    // Fresh swing high rejection
    if (swingHighs.length > 0) {
      const lastHigh = swingHighs[swingHighs.length - 1].price;
      if (current <= lastHigh && lastHigh - current <= 1.0 * atr) return true;
    }
  }
  return false;
}

/**
 * Condition 2 — Confirmation Candle.
 * At least one of the last 2 closed candles confirms direction.
 */
function checkConfirmationCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 2) return false;
  return candles.slice(-2).some((c) => {
    const range = Math.max(c.high - c.low, Number.EPSILON);
    const bodyRatio = Math.abs(c.close - c.open) / range;
    const closeNearExtreme = direction === "BUY"
      ? (c.high - c.close) / range <= 0.25
      : (c.close - c.low) / range <= 0.25;
    const directional = direction === "BUY" ? c.close > c.open : c.close < c.open;
    return directional && bodyRatio >= 0.45 && closeNearExtreme;
  });
}

/**
 * Condition 3 — Momentum Candle.
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

export function scoreToLevel(score: number): ConfidenceLevel {
  // Cutoffs are data-driven: fitted on the calibration split, then checked on
  // the chronological holdout. 35/45/55 was the configuration that stayed
  // monotonic in both splits and kept the top band positive on every pair.
  // Re-validate whenever the weights or the sample window change.
  if (score >= 55) return "High";
  if (score >= 45) return "Medium";
  if (score >= 35) return "Low";
  return "VeryLow";
}

export interface CriticalScoreFlags {
  timeframeAligned: boolean;
  confirmationCandle: boolean;
  riskRewardRatio: number;
  newsStatus: NewsRisk["status"];
}

/**
 * The score is purely additive: 100 x the checklist weights that pass, plus the
 * news weight. It is never clamped to a ceiling, because clamping made the
 * displayed score weaker than the checklist justified and hid genuinely good
 * setups behind a number the user could not reconcile with the factors.
 *
 * Critical gaps are still detected, but only as warnings. They explain the risk
 * next to the score and they feed the setup advisory (an RR below 1 still marks
 * the setup WAIT), without rewriting the score itself.
 *
 * The reward/risk ladder that used to cap the score was fitted on calibration
 * and checked on the holdout: RR >= 2 was the only bucket non-negative in both
 * splits, while 0.5-2 flipped sign between them. That is a reason to warn, not
 * a reason to overwrite a score.
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
    advisories.push("data berita tidak tersedia; bobot berita dikurangi");
  }

  return {
    score: Math.max(0, Math.min(100, baseScore)),
    advisories,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
  const timeframeAligned =
    h1Trend.marketState === "TRENDING" &&
    m15Trend.marketState === "TRENDING" &&
    h1Trend.direction === m15Trend.direction;
  const structureAligned =
    h1Trend.structure === (bias === "BUY" ? "HH-HL" : "LH-LL") &&
    m15Trend.structure === (bias === "BUY" ? "HH-HL" : "LH-LL");
  const dmiAligned =
    (bias === "BUY"
      ? h1Trend.diPlus > h1Trend.diMinus && m15Trend.diPlus > m15Trend.diMinus
      : h1Trend.diMinus > h1Trend.diPlus && m15Trend.diMinus > m15Trend.diPlus) &&
    h1Trend.adx >= 20 &&
    m15Trend.adx >= 20 &&
    h1Trend.adxSlope > -3 &&
    m15Trend.adxSlope > -3;
  const newsControlled = newsRisk.riskScore < 35 && newsRisk.status === "CLEAR";
  const confirmationCandle = checkConfirmationCandle(candles, bias);

  const checklist: ChecklistItem[] = [
    { label: "Alignment H1/M15",     passed: timeframeAligned,                        weight: SCORING_WEIGHTS.alignment },
    { label: "Struktur HH-HL/LH-LL", passed: structureAligned,                        weight: SCORING_WEIGHTS.structure },
    { label: "DMI + ADX Mendukung",  passed: dmiAligned,                              weight: SCORING_WEIGHTS.dmi },
    { label: "Harga di Value Zone",  passed: checkNearHLLH(candles, bias, atr),       weight: SCORING_WEIGHTS.valueZone },
    { label: "Confirmation Candle",  passed: confirmationCandle,                      weight: SCORING_WEIGHTS.confirmation },
    { label: "Momentum Sehat",       passed: checkHealthyMomentum(candles, bias, atr) && checkMomentumCandle(candles, bias), weight: SCORING_WEIGHTS.momentum },
    { label: "Risk Reward Bagus",    passed: plannedRiskReward >= 1.5,                weight: SCORING_WEIGHTS.rewardRisk },
    { label: "Risiko Berita Rendah", passed: newsControlled,                          weight: SCORING_WEIGHTS.news },
  ];

  // News and reward/risk are scored continuously. Their checklist passed states
  // are display-only; awarding the full weight twice would double-count them.
  // RR is normalised against 3R, so 1.5R earns half of its weight.
  const rawScore = checklist.reduce((acc, item) => {
    if (item.label === "Risiko Berita Rendah") {
      return acc + item.weight * (1 - Math.max(0, Math.min(100, newsRisk.riskScore)) / 100);
    }
    if (item.label === "Risk Reward Bagus") {
      const rrFraction = Math.max(0, Math.min(1, plannedRiskReward / 3));
      return acc + item.weight * rrFraction;
    }
    return acc + (item.passed ? item.weight : 0);
  }, 0);
  const baseScore = Math.round(rawScore * 100);
  const { score, advisories } = applyScoreAdvisories(baseScore, {
    timeframeAligned,
    confirmationCandle,
    riskRewardRatio: plannedRiskReward,
    newsStatus: newsRisk.status,
  });
  const level = scoreToLevel(score);
  // Deprecated compatibility field: the score is advisory and never a hard gate.
  const tradeAllowed = true;

  const warnings = [
    !timeframeAligned ? "arah/state H1-M15 belum selaras" : "",
    !structureAligned ? "struktur swing belum mendukung penuh" : "",
    !dmiAligned ? "DMI/ADX belum mendukung penuh" : "",
    !checklist[3].passed ? "harga belum dekat zona value" : "",
    !checklist[4].passed ? "candle konfirmasi belum kuat" : "",
    !checklist[6].passed ? "RR rencana di bawah 1:1.5" : "",
    newsRisk.status === "HIGH_RISK" ? `risiko berita tinggi: ${newsRisk.headline}` : "",
    newsRisk.status === "CAUTION" ? `risiko berita sedang: ${newsRisk.headline}` : "",
    newsRisk.status === "UNAVAILABLE" ? "data berita tidak lengkap; skor disesuaikan" : "",
  ].filter(Boolean);

  const capNote = advisories.length > 0
    ? ` Perhatian: ${advisories.join("; ")}.`
    : "";

  return {
    score,
    level,
    advisories,
    checklist,
    timeframeAligned,
    tradeAllowed,
    note: `Skor konfluensi ${pair}: ${score}/100 (heuristik, bukan probabilitas menang). Ini peringatan saja—sistem tidak memblokir setup.${capNote}${warnings.length > 0 ? ` Perlu diperhatikan: ${warnings.join("; ")}.` : " Tidak ada peringatan utama; tetap kelola risiko."}`,
  };
}
