/**
 * EntryConfidenceService
 *
 * Calculates entry confidence (0–100%) from real M15 OHLCV candles.
 *
 * Conditions and weights:
 *   1. Harga dekat HL/LH  (35%) — price in value zone near EMA21, not overextended
 *   2. Confirmation Candle (25%) — at least 1 of last 2 closed candles confirms trend
 *   3. Momentum Candle     (20%) — any of last 5 candles has strong directional body (≥55%)
 *   4. Risk Reward Bagus   (20%) — RR ≥ 1.5 using swing TP / ATR-based SL
 *   Alignment bonus (+5%)  — H1 and M15 directions agree
 */

import type { Candle } from "./TwelveDataService.js";
import { calcATR, calcEMA, findSwingHighs, findSwingLows } from "./TwelveDataService.js";
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
 * BUY: price above EMA21 AND within 1.5 ATR above it (not overextended upward)
 *      OR: price within 2 ATR above last swing low (fresh HL bounce)
 * SELL: price below EMA21 AND within 1.5 ATR below it
 *      OR: price within 2 ATR below last swing high (fresh LH rejection)
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

  const swingHighs = findSwingHighs(candles, 2, atr, 0.3);
  const swingLows = findSwingLows(candles, 2, atr, 0.3);

  if (direction === "BUY") {
    // EMA21 proximity
    if (current >= ema21 && current - ema21 <= 1.0 * atr) return true;
    // Fresh swing low bounce
    if (swingLows.length > 0) {
      const lastLow = swingLows[swingLows.length - 1];
       if (current >= lastLow && current - lastLow <= 1.5 * atr) return true;
    }
  } else {
    // EMA21 proximity
    if (current <= ema21 && ema21 - current <= 1.0 * atr) return true;
    // Fresh swing high rejection
    if (swingHighs.length > 0) {
      const lastHigh = swingHighs[swingHighs.length - 1];
       if (current <= lastHigh && lastHigh - current <= 1.5 * atr) return true;
    }
  }
  return false;
}

/**
 * Condition 2 — Confirmation Candle.
 * At least 1 of the last 2 CLOSED candles (index −2 and −3) confirms direction.
 * Using 2 candles gives tolerance for 1-bar consolidation.
 */
function checkConfirmationCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 2) return false;
  const c = candles[candles.length - 1];
  const range = Math.max(c.high - c.low, Number.EPSILON);
  const body = Math.abs(c.close - c.open);
  const bodyRatio = body / range;
  const closeNearExtreme = direction === "BUY"
    ? (c.high - c.close) / range <= 0.25
    : (c.close - c.low) / range <= 0.25;
  const directional = direction === "BUY" ? c.close > c.open : c.close < c.open;
  return directional && bodyRatio >= 0.45 && closeNearExtreme;
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

/**
 * Condition 4 — Risk Reward ≥ 1.5:1.
 *
 * SL = last swing low/high ± 0.3 ATR buffer (capped at min 0.5 ATR distance)
 * TP = nearest swing level beyond current price, or 2.5 ATR projection
 */
function checkRiskReward(
  candles: Candle[],
  direction: TrendDirection,
  atr: number,
): boolean {
  const current = candles[candles.length - 1].close;
  const swingHighs = findSwingHighs(candles, 2, atr, 0.3);
  const swingLows = findSwingLows(candles, 2, atr, 0.3);

  if (direction === "BUY") {
    const lastLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : current - atr;
    const risk = Math.max(current - lastLow, 0.5 * atr);
    const higherSwing = [...swingHighs].reverse().find((h) => h > current);
    const reward = (higherSwing ?? current + 2.5 * atr) - current;
    return reward > 0 && reward / risk >= 1.5;
  } else {
    const lastHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : current + atr;
    const risk = Math.max(lastHigh - current, 0.5 * atr);
    const lowerSwing = [...swingLows].reverse().find((l) => l < current);
    const reward = current - (lowerSwing ?? current - 2.5 * atr);
    return reward > 0 && reward / risk >= 1.5;
  }
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
  const newsControlled = newsRisk.status === "CLEAR";

  const checklist: ChecklistItem[] = [
    { label: "Alignment H1/M15",      passed: timeframeAligned,                         weight: 0.20 },
    { label: "Struktur HH-HL/LH-LL",  passed: structureAligned,                         weight: 0.15 },
    { label: "DMI + ADX Mendukung",   passed: dmiAligned,                              weight: 0.15 },
    { label: "Harga di Value Zone",   passed: checkNearHLLH(candles, bias, atr),        weight: 0.15 },
    { label: "Confirmation Candle",   passed: checkConfirmationCandle(candles, bias),   weight: 0.15 },
    { label: "Momentum Sehat",        passed: checkHealthyMomentum(candles, bias, atr) && checkMomentumCandle(candles, bias), weight: 0.10 },
    { label: "Risk Reward Bagus",      passed: plannedRiskReward >= 1.5,                weight: 0.05 },
    { label: "News Risk Terkendali",  passed: newsControlled,                           weight: 0.05 },
  ];

  const rawScore = checklist.reduce((acc, item) => acc + (item.passed ? item.weight : 0), 0);
  const unalignedScore = Math.round(rawScore * 100);
  const newsPenalty = newsRisk.status === "BLOCKED" ? 35 : newsRisk.status === "CAUTION" ? 15 : newsRisk.status === "UNAVAILABLE" ? 25 : 0;
  const score = timeframeAligned
    ? Math.max(0, Math.min(100, unalignedScore - newsPenalty))
    : Math.min(35, Math.round(unalignedScore * 0.55));
  const level = scoreToLevel(score);
  const tradeAllowed = timeframeAligned &&
    structureAligned &&
    dmiAligned &&
    plannedRiskReward >= 1.5 &&
    newsRisk.status === "CLEAR" &&
    score >= 65;

  return {
    score,
    level,
    checklist,
    timeframeAligned,
    tradeAllowed,
    note: tradeAllowed
      ? "Konfluensi struktur, DMI/ADX, value zone, RR, dan headline risk valid. Entry tetap menunggu harga serta candle konfirmasi."
      : newsRisk.status === "BLOCKED"
        ? "Entry diblokir karena ada berita berdampak tinggi pada jendela risiko."
        : newsRisk.status === "UNAVAILABLE"
          ? "Entry diblokir karena data berita tidak tersedia untuk divalidasi."
          : "Belum ada konfluensi valid untuk entry. Jangan memaksakan posisi.",
  };
}
