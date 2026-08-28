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
import type { MarketState, TrendDirection } from "./MarketStructureService.js";

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
    if (current >= ema21 && current - ema21 <= 1.5 * atr) return true;
    // Fresh swing low bounce
    if (swingLows.length > 0) {
      const lastLow = swingLows[swingLows.length - 1];
      if (current >= lastLow && current - lastLow <= 2 * atr) return true;
    }
  } else {
    // EMA21 proximity
    if (current <= ema21 && ema21 - current <= 1.5 * atr) return true;
    // Fresh swing high rejection
    if (swingHighs.length > 0) {
      const lastHigh = swingHighs[swingHighs.length - 1];
      if (current <= lastHigh && lastHigh - current <= 2 * atr) return true;
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
  if (candles.length < 3) return false;
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 3];
  const confirms = (c: Candle) =>
    direction === "BUY" ? c.close > c.open : c.close < c.open;
  return confirms(c1) || confirms(c2);
}

/**
 * Condition 3 — Momentum Candle.
 * Any of last 5 closed candles has a strong body (≥55% of range) in the trend direction.
 */
function checkMomentumCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 3) return false;
  return candles.slice(-6, -1).some((c) => {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return false;
    const strongBody = body / range >= 0.55;
    const correctDir = direction === "BUY" ? c.close > c.open : c.close < c.open;
    return strongBody && correctDir;
  });
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
  h1Direction: TrendDirection,
  m15Direction: TrendDirection,
  candles: Candle[],
  h1State: MarketState,
  m15State: MarketState,
): ConfidenceResult {
  const bias = h1Direction;
  const atr = calcATR(candles, 14);

  const checklist: ChecklistItem[] = [
    { label: "Harga dekat HL/LH",   passed: checkNearHLLH(candles, bias, atr),       weight: 0.35 },
    { label: "Confirmation Candle", passed: checkConfirmationCandle(candles, bias),   weight: 0.25 },
    { label: "Momentum Candle",     passed: checkMomentumCandle(candles, bias),       weight: 0.20 },
    { label: "Risk Reward Bagus",   passed: checkRiskReward(candles, bias, atr),      weight: 0.20 },
  ];

  const rawScore = checklist.reduce((acc, item) => acc + (item.passed ? item.weight : 0), 0);
  const timeframeAligned =
    h1State === "TRENDING" &&
    m15State === "TRENDING" &&
    h1Direction === m15Direction;

  // A technically good M15 setup is not actionable when the higher
  // timeframe disagrees or either timeframe is ranging/transitioning.
  const unalignedScore = Math.round(rawScore * 100);
  const score = timeframeAligned
    ? Math.min(100, unalignedScore + 5)
    : Math.min(40, Math.round(unalignedScore * 0.6));
  const level = scoreToLevel(score);
  const tradeAllowed = timeframeAligned && score >= 60;

  return {
    score,
    level,
    checklist,
    timeframeAligned,
    tradeAllowed,
    note: tradeAllowed
      ? "Konfluensi H1 dan M15 valid. Entry tetap menunggu harga berada di zona dan candle konfirmasi."
      : "Belum ada konfluensi valid untuk entry. Jangan memaksakan posisi.",
  };
}
