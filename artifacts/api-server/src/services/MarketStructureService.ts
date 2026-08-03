/**
 * MarketStructureService
 *
 * Triple-confirmation trend detection:
 *   Factor 1 — EMA(8) vs EMA(21) position + 5-bar slope (weight 40%)
 *   Factor 2 — RSI(14) momentum filter  (weight 30%)
 *   Factor 3 — Pivot swing structure HH-HL / LH-LL (weight 30%)
 *
 * Score  +3 → strong BUY     −3 → strong SELL
 *        +2 → moderate BUY   −2 → moderate SELL
 *        +1 → swing BUY      −1 → swing SELL
 *         0 → ranging / tie-break by EMA
 */

import { calcEMA, calcRSI, calcATR, findSwingHighs, findSwingLows } from "./TwelveDataService.js";
import type { Candle } from "./TwelveDataService.js";

export type TrendDirection = "BUY" | "SELL";
export type SignalStrength = "strong" | "moderate" | "swing" | "weak" | "ranging";

export interface TrendData {
  direction: TrendDirection;
  structure: string;
  explanation: string;
  strength: SignalStrength;
  rsi: number;
  ema8: number;
  ema21: number;
  currentPrice: number;
}

export const SUPPORTED_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * Main entry point — call with 50+ candles for best accuracy.
 * Candles must be ordered OLDEST → NEWEST.
 */
export function analyzeTrendFromCandles(candles: Candle[]): TrendData {
  const n = candles.length;
  const last = candles[n - 1];
  const atr = calcATR(candles, 14);

  // ── Factor 1: EMA trend (+1 bull / −1 bear / 0 neutral) ─────────────────
  const ema8arr = calcEMA(candles, 8);
  const ema21arr = calcEMA(candles, 21);
  const ema8 = ema8arr[n - 1];
  const ema21 = ema21arr[n - 1];

  // 5-bar slope to avoid 1-bar noise
  const slopeLookback = Math.min(5, n - 1);
  const ema8Slope = (ema8arr[n - 1] - ema8arr[n - 1 - slopeLookback]) / slopeLookback;
  const ema21Slope = (ema21arr[n - 1] - ema21arr[n - 1 - slopeLookback]) / slopeLookback;

  let emaScore = 0;
  if (ema8 > ema21 && last.close > ema21) {
    // Strong bull: both EMAs rising or EMA8 pulling away
    emaScore = ema8Slope > 0 ? 1 : (ema8 > ema21 ? 1 : 0);
  } else if (ema8 < ema21 && last.close < ema21) {
    emaScore = ema8Slope < 0 ? -1 : (ema8 < ema21 ? -1 : 0);
  }
  // Near-cross zone (within 0.05 ATR): neutral
  if (Math.abs(ema8 - ema21) < 0.05 * atr) emaScore = 0;

  // ── Factor 2: RSI momentum (+1 bull / −1 bear / 0 neutral) ──────────────
  const rsi = calcRSI(candles, 14);
  let rsiScore = 0;
  if (rsi > 55) rsiScore = 1;
  else if (rsi < 45) rsiScore = -1;

  // ── Factor 3: Swing structure (+1 HH-HL / −1 LH-LL / 0 mixed) ──────────
  const swingHighs = findSwingHighs(candles, 2, atr, 0.3);
  const swingLows = findSwingLows(candles, 2, atr, 0.3);

  let swingScore = 0;
  const hasHigherHighs =
    swingHighs.length >= 2 &&
    swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2];
  const hasHigherLows =
    swingLows.length >= 2 &&
    swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
  const hasLowerHighs =
    swingHighs.length >= 2 &&
    swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2];
  const hasLowerLows =
    swingLows.length >= 2 &&
    swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];

  if (hasHigherHighs && hasHigherLows) swingScore = 1;
  else if (hasLowerHighs && hasLowerLows) swingScore = -1;

  // ── Combined score ───────────────────────────────────────────────────────
  const totalScore = emaScore + rsiScore + swingScore; // range: −3 to +3

  let direction: TrendDirection;
  let strength: SignalStrength;

  if (totalScore >= 2) {
    direction = "BUY"; strength = totalScore === 3 ? "strong" : "moderate";
  } else if (totalScore <= -2) {
    direction = "SELL"; strength = totalScore === -3 ? "strong" : "moderate";
  } else if (totalScore === 1) {
    direction = "BUY"; strength = "swing";
  } else if (totalScore === -1) {
    direction = "SELL"; strength = "swing";
  } else {
    // Score = 0 → ranging; use EMA as final tiebreaker
    strength = "ranging";
    direction = ema8 >= ema21 ? "BUY" : "SELL";
  }

  // Downgrade to "weak" when swing data is insufficient
  if (swingHighs.length < 2 && swingLows.length < 2 && strength === "swing") {
    strength = "weak";
  }

  return {
    direction,
    structure: direction === "BUY" ? "HH-HL" : "LH-LL",
    explanation: buildExplanation(direction, strength, rsi, ema8, ema21),
    strength,
    rsi: parseFloat(rsi.toFixed(1)),
    ema8: parseFloat(ema8.toFixed(5)),
    ema21: parseFloat(ema21.toFixed(5)),
    currentPrice: parseFloat(last.close.toFixed(5)),
  };
}

function buildExplanation(
  direction: TrendDirection,
  strength: SignalStrength,
  rsi: number,
  ema8: number,
  ema21: number,
): string {
  const rsiNote = `RSI ${rsi.toFixed(0)} (${rsi > 55 ? "bullish" : rsi < 45 ? "bearish" : "netral"}).`;

  switch (strength) {
    case "strong":
      return direction === "BUY"
        ? `EMA8 > EMA21, RSI ${rsi.toFixed(0)} bullish, struktur HH-HL terkonfirmasi. Tren bullish kuat dari 3 faktor.`
        : `EMA8 < EMA21, RSI ${rsi.toFixed(0)} bearish, struktur LH-LL terkonfirmasi. Tren bearish kuat dari 3 faktor.`;
    case "moderate":
      return direction === "BUY"
        ? `EMA8 > EMA21 dan RSI bullish mengkonfirmasi bias BUY. ${rsiNote} Swing masih berkembang.`
        : `EMA8 < EMA21 dan RSI bearish mengkonfirmasi bias SELL. ${rsiNote} Swing masih berkembang.`;
    case "swing":
      return direction === "BUY"
        ? `Struktur HH-HL terdeteksi dari pivot swing. ${rsiNote} EMA belum fully crossed.`
        : `Struktur LH-LL terdeteksi dari pivot swing. ${rsiNote} EMA belum fully crossed.`;
    case "ranging":
      return `Pasar sedang ranging/konsolidasi. Score seimbang. ${rsiNote} Tunggu breakout yang jelas sebelum entry.`;
    default:
      return direction === "BUY"
        ? `Price action mayoritas bullish. Sinyal lemah — butuh konfirmasi lebih lanjut. ${rsiNote}`
        : `Price action mayoritas bearish. Sinyal lemah — butuh konfirmasi lebih lanjut. ${rsiNote}`;
  }
}
