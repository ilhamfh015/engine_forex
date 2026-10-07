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

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
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

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 71) return "High";
  if (score >= 41) return "Medium";
  return "Low";
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

  const checklist: ChecklistItem[] = [
    { label: "Alignment H1/M15",     passed: timeframeAligned,                        weight: 0.20 },
    { label: "Struktur HH-HL/LH-LL", passed: structureAligned,                        weight: 0.15 },
    { label: "DMI + ADX Mendukung",  passed: dmiAligned,                             weight: 0.15 },
    { label: "Harga di Value Zone",  passed: checkNearHLLH(candles, bias, atr),       weight: 0.13 },
    { label: "Confirmation Candle",  passed: checkConfirmationCandle(candles, bias),  weight: 0.13 },
    { label: "Momentum Sehat",       passed: checkHealthyMomentum(candles, bias, atr) && checkMomentumCandle(candles, bias), weight: 0.09 },
    { label: "Risk Reward Bagus",    passed: plannedRiskReward >= 1.5,               weight: 0.05 },
    { label: "Risiko Berita Rendah", passed: newsControlled,                          weight: 0.10 },
  ];

  // News is scored once, continuously by provider risk score. The checklist's
  // passed state is for display only; it is not subtracted a second time.
  const rawScore = checklist.reduce((acc, item) => {
    if (item.label === "Risiko Berita Rendah") {
      return acc + item.weight * (1 - Math.max(0, Math.min(100, newsRisk.riskScore)) / 100);
    }
    return acc + (item.passed ? item.weight : 0);
  }, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));
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

  return {
    score,
    level,
    checklist,
    timeframeAligned,
    tradeAllowed,
    note: `Skor konfluensi ${pair}: ${score}/100 (heuristik, bukan probabilitas menang). Ini peringatan saja—sistem tidak memblokir setup.${warnings.length > 0 ? ` Perlu diperhatikan: ${warnings.join("; ")}.` : " Tidak ada peringatan utama; tetap kelola risiko."}`,
  };
}
