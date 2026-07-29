/**
 * MarketStructureService
 *
 * Dual-confirmation trend detection using:
 *   1. EMA(8) vs EMA(21) crossover  — primary trend bias
 *   2. Pivot swing structure (HH-HL / LH-LL) — structural confirmation
 *
 * Signal strength levels:
 *   "strong"   — EMA and swing both agree
 *   "moderate" — EMA confirms, swing unclear or partial
 *   "swing"    — Swing confirms, EMA slightly mixed
 *   "weak"     — Fallback: recent candle majority
 */

import { calcEMA, findSwingHighs, findSwingLows } from "./TwelveDataService.js";
import type { Candle } from "./TwelveDataService.js";

export type TrendDirection = "BUY" | "SELL";
export type SignalStrength = "strong" | "moderate" | "swing" | "weak";

export interface TrendData {
  direction: TrendDirection;
  structure: string;
  explanation: string;
  strength: SignalStrength;
  ema8: number;
  ema21: number;
  currentPrice: number;
}

export const SUPPORTED_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * Analyzes trend direction from OHLCV candles using EMA + swing structure.
 *
 * @param candles - Ordered OLDEST → NEWEST (as returned by TwelveDataService)
 */
export function analyzeTrendFromCandles(candles: Candle[]): TrendData {
  const n = candles.length;
  const last = candles[n - 1];

  // ── 1. EMA trend bias ────────────────────────────────────────────────────
  const ema8arr = calcEMA(candles, 8);
  const ema21arr = calcEMA(candles, 21);
  const ema8 = ema8arr[n - 1];
  const ema21 = ema21arr[n - 1];
  const prevEma8 = ema8arr[n - 2] ?? ema8;
  const prevEma21 = ema21arr[n - 2] ?? ema21;

  // "Golden/death cross momentum": current AND previous bar EMA slope agree
  const emaBullish =
    ema8 > ema21 &&
    last.close > ema21 &&
    (ema8 > prevEma8 || ema21 < prevEma21); // at least one EMA moving in trend direction

  const emaBearish =
    ema8 < ema21 &&
    last.close < ema21 &&
    (ema8 < prevEma8 || ema21 > prevEma21);

  // ── 2. Swing structure (HH-HL / LH-LL) ──────────────────────────────────
  const swingHighs = findSwingHighs(candles, 2);
  const swingLows = findSwingLows(candles, 2);

  const hasEnoughSwings = swingHighs.length >= 2 && swingLows.length >= 2;

  const hhhl =
    hasEnoughSwings &&
    swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2] &&
    swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];

  const lhll =
    hasEnoughSwings &&
    swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2] &&
    swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];

  // ── 3. Combine signals ───────────────────────────────────────────────────
  if (emaBullish && hhhl) {
    return buildResult("BUY", "strong", "strong", ema8, ema21, last.close);
  }
  if (emaBearish && lhll) {
    return buildResult("SELL", "strong", "strong", ema8, ema21, last.close);
  }
  if (emaBullish && lhll) {
    // EMA says BUY but swing says SELL — EMA is more current, use it with caution
    return buildResult("BUY", "LH-LL", "moderate", ema8, ema21, last.close);
  }
  if (emaBearish && hhhl) {
    // EMA says SELL but swing says BUY — EMA is more current
    return buildResult("SELL", "HH-HL", "moderate", ema8, ema21, last.close);
  }
  if (emaBullish) {
    return buildResult("BUY", "moderate", "moderate", ema8, ema21, last.close);
  }
  if (emaBearish) {
    return buildResult("SELL", "moderate", "moderate", ema8, ema21, last.close);
  }
  if (hhhl) {
    return buildResult("BUY", "swing", "swing", ema8, ema21, last.close);
  }
  if (lhll) {
    return buildResult("SELL", "swing", "swing", ema8, ema21, last.close);
  }

  // Fallback: recent candle majority
  const recentBullish = candles.slice(-5).filter((c) => c.close > c.open).length;
  const dir: TrendDirection = recentBullish >= 3 ? "BUY" : "SELL";
  return buildResult(dir, "weak", "weak", ema8, ema21, last.close);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(
  direction: TrendDirection,
  structureHint: string,
  strength: SignalStrength,
  ema8: number,
  ema21: number,
  currentPrice: number,
): TrendData {
  const structure = structureHint === "strong"
    ? (direction === "BUY" ? "HH-HL" : "LH-LL")
    : structureHint === "moderate" || structureHint === "weak"
      ? (direction === "BUY" ? "HH-HL" : "LH-LL")
      : structureHint; // "swing" or passed directly

  // Use normalized structure labels
  const normalizedStructure =
    direction === "BUY" ? "HH-HL" : "LH-LL";

  return {
    direction,
    structure: normalizedStructure,
    explanation: buildExplanation(direction, strength),
    strength,
    ema8: parseFloat(ema8.toFixed(5)),
    ema21: parseFloat(ema21.toFixed(5)),
    currentPrice: parseFloat(currentPrice.toFixed(5)),
  };
}

function buildExplanation(direction: TrendDirection, strength: SignalStrength): string {
  const dir = direction === "BUY" ? "bullish" : "bearish";
  const dirID = direction === "BUY" ? "BUY" : "SELL";

  switch (strength) {
    case "strong":
      return direction === "BUY"
        ? "EMA8 di atas EMA21 dan harga mencetak HH-HL. Tren bullish kuat terkonfirmasi dari dua sisi."
        : "EMA8 di bawah EMA21 dan harga mencetak LH-LL. Tren bearish kuat terkonfirmasi dari dua sisi.";
    case "moderate":
      return direction === "BUY"
        ? "EMA8 > EMA21, harga di atas EMA21. Bias bullish dari momentum EMA, swing masih berkembang."
        : "EMA8 < EMA21, harga di bawah EMA21. Bias bearish dari momentum EMA, swing masih berkembang.";
    case "swing":
      return direction === "BUY"
        ? "Struktur HH-HL terkonfirmasi dari pivot swing. EMA belum fully crossed — menunggu konfirmasi lanjutan."
        : "Struktur LH-LL terkonfirmasi dari pivot swing. EMA belum fully crossed — menunggu konfirmasi lanjutan.";
    case "weak":
    default:
      return direction === "BUY"
        ? "Price action mayoritas bullish pada candle terakhir. Sinyal lemah — perlu konfirmasi lebih lanjut."
        : "Price action mayoritas bearish pada candle terakhir. Sinyal lemah — perlu konfirmasi lebih lanjut.";
  }
}
