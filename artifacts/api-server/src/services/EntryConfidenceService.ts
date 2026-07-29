/**
 * EntryConfidenceService
 *
 * Calculates entry confidence (0–100%) from real M15 OHLCV candles.
 *
 * Conditions and weights:
 *   1. Harga dekat HL/LH  (35%) — price in "value zone" near EMA21, not overextended
 *   2. Confirmation Candle (25%) — at least 1 of last 2 closed candles confirms trend
 *   3. Momentum Candle     (20%) — any of last 5 candles shows strong directional body
 *   4. Risk Reward Bagus   (20%) — RR ≥ 1.5 using swing-based TP and ATR-capped SL
 */

import type { Candle } from "./TwelveDataService.js";
import { calcATR, calcEMA, findSwingHighs, findSwingLows } from "./TwelveDataService.js";
import type { TrendDirection } from "./MarketStructureService.js";

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
}

const CONDITIONS: Array<{ label: string; weight: number }> = [
  { label: "Harga dekat HL/LH", weight: 0.35 },
  { label: "Confirmation Candle", weight: 0.25 },
  { label: "Momentum Candle", weight: 0.20 },
  { label: "Risk Reward Bagus", weight: 0.20 },
];

/**
 * Condition 1 — Price in value zone (near EMA21, not overextended).
 *
 * In a trending market the HL/LH "zone" IS the EMA21:
 *   BUY:  price above EMA21 (trend confirmed) AND within 1.5 ATR of EMA21
 *         → price pulled back to value zone, not overextended above
 *   SELL: price below EMA21 AND within 1.5 ATR of EMA21
 *         → price rallied to value zone, not overextended below
 *
 * Also accepts when the most recent swing low (BUY) or swing high (SELL)
 * was formed within the last 6 candles — fresh bounce from structure.
 */
function checkNearHLLH(candles: Candle[], direction: TrendDirection, atr: number): boolean {
  const n = candles.length;
  const current = candles[n - 1].close;
  const ema21arr = calcEMA(candles, 21);
  const ema21 = ema21arr[n - 1];

  // EMA21 proximity check
  const distFromEMA = Math.abs(current - ema21);
  if (distFromEMA <= 1.5 * atr) {
    // For BUY: price must be at or above EMA21 (not below it)
    // For SELL: price must be at or below EMA21
    if (direction === "BUY" && current >= ema21) return true;
    if (direction === "SELL" && current <= ema21) return true;
  }

  // Recent swing bounce check (within last 6 candles)
  const swingHighs = findSwingHighs(candles, 2);
  const swingLows = findSwingLows(candles, 2);

  if (direction === "BUY" && swingLows.length > 0) {
    const lastSwingLow = swingLows[swingLows.length - 1];
    // Price bounced from HL: currently within 2 ATR above last swing low
    return current >= lastSwingLow && current - lastSwingLow <= 2 * atr;
  }

  if (direction === "SELL" && swingHighs.length > 0) {
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    // Price rejected from LH: currently within 2 ATR below last swing high
    return current <= lastSwingHigh && lastSwingHigh - current <= 2 * atr;
  }

  return false;
}

/**
 * Condition 2 — Confirmation Candle.
 *
 * At least 1 of the last 2 CLOSED candles (indices -2 and -3) must confirm
 * the trend direction. Using 2 candles gives tolerance for minor consolidation.
 *
 *   BUY:  close > open (bullish body)
 *   SELL: close < open (bearish body)
 */
function checkConfirmationCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 3) return false;
  const c1 = candles[candles.length - 2]; // last closed
  const c2 = candles[candles.length - 3]; // 2nd-to-last closed

  const confirms = (c: Candle) =>
    direction === "BUY" ? c.close > c.open : c.close < c.open;

  return confirms(c1) || confirms(c2);
}

/**
 * Condition 3 — Momentum Candle.
 *
 * Checks if any of the last 5 candles has a strong directional body
 * (body ≥ 55% of total range) matching the trend direction.
 * This detects the "impulse" move that drives the trend.
 */
function checkMomentumCandle(candles: Candle[], direction: TrendDirection): boolean {
  if (candles.length < 3) return false;
  const slice = candles.slice(-6, -1); // last 5 closed candles

  return slice.some((c) => {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return false;
    const strongBody = body / range >= 0.55;
    const correctDir =
      direction === "BUY" ? c.close > c.open : c.close < c.open;
    return strongBody && correctDir;
  });
}

/**
 * Condition 4 — Risk Reward ≥ 1.5:1.
 *
 * SL placement:
 *   BUY:  last swing low (capped: min SL distance = 0.5 ATR)
 *   SELL: last swing high (capped: min SL distance = 0.5 ATR)
 *
 * TP placement:
 *   BUY:  nearest swing high ABOVE current price.
 *         If no swing high above (price broke out) → project 2.5 ATR.
 *   SELL: nearest swing low BELOW current price.
 *         If no swing low below (price broke down) → project 2.5 ATR.
 *
 * Require: reward / risk ≥ 1.5
 */
function checkRiskReward(candles: Candle[], direction: TrendDirection, atr: number): boolean {
  const current = candles[candles.length - 1].close;
  const swingHighs = findSwingHighs(candles, 2);
  const swingLows = findSwingLows(candles, 2);

  if (direction === "BUY") {
    const lastSwingLow =
      swingLows.length > 0 ? swingLows[swingLows.length - 1] : current - atr;
    const risk = Math.max(current - lastSwingLow, 0.5 * atr);

    // Find nearest swing high above current price
    const higherSwing = [...swingHighs].reverse().find((h) => h > current);
    const target = higherSwing ?? current + 2.5 * atr;
    const reward = target - current;

    return reward > 0 && reward / risk >= 1.5;
  } else {
    const lastSwingHigh =
      swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : current + atr;
    const risk = Math.max(lastSwingHigh - current, 0.5 * atr);

    // Find nearest swing low below current price
    const lowerSwing = [...swingLows].reverse().find((l) => l < current);
    const target = lowerSwing ?? current - 2.5 * atr;
    const reward = current - target;

    return reward > 0 && reward / risk >= 1.5;
  }
}

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 71) return "High";
  if (score >= 41) return "Medium";
  return "Low";
}

/**
 * Calculates entry confidence from real M15 candles.
 *
 * @param pair         - Pair string (for future use / logging)
 * @param h1Direction  - Trend direction on H1 (primary bias)
 * @param m15Direction - Trend direction on M15
 * @param candles      - M15 OHLCV candles (oldest → newest, ≥ 30 recommended)
 */
export function calculateConfidence(
  pair: string,
  h1Direction: TrendDirection,
  m15Direction: TrendDirection,
  candles: Candle[],
): ConfidenceResult {
  const bias = h1Direction; // H1 drives the trade direction
  const atr = calcATR(candles, 14);

  const checklist: ChecklistItem[] = [
    {
      label: CONDITIONS[0].label,
      passed: checkNearHLLH(candles, bias, atr),
      weight: CONDITIONS[0].weight,
    },
    {
      label: CONDITIONS[1].label,
      passed: checkConfirmationCandle(candles, bias),
      weight: CONDITIONS[1].weight,
    },
    {
      label: CONDITIONS[2].label,
      passed: checkMomentumCandle(candles, bias),
      weight: CONDITIONS[2].weight,
    },
    {
      label: CONDITIONS[3].label,
      passed: checkRiskReward(candles, bias, atr),
      weight: CONDITIONS[3].weight,
    },
  ];

  const rawScore = checklist.reduce((acc, item) => acc + (item.passed ? item.weight : 0), 0);

  // +5% alignment bonus when both timeframes agree
  const alignmentBonus = h1Direction === m15Direction ? 0.05 : 0;
  const score = Math.min(100, Math.round((rawScore + alignmentBonus) * 100));

  return { score, level: scoreToLevel(score), checklist };
}
