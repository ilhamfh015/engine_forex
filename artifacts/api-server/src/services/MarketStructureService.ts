/**
 * MarketStructureService
 *
 * Conservative, closed-candle trend detection.
 *
 * The detector never treats one indicator as truth. It combines:
 *   1. Confirmed pivot structure (HH-HL / LH-LL)       — primary evidence
 *   2. EMA 20/50 position and slope                    — trend filter
 *   3. RSI(14)                                          — momentum filter
 *   4. ADX(14)                                          — trend-strength filter
 *
 * If the evidence conflicts, the response explicitly says TRANSITION or
 * RANGING so the UI can tell the trader not to force an entry.
 */

import {
  calcADX,
  calcATR,
  calcEMA,
  calcRSI,
  findSwingHighs,
  findSwingLows,
} from "./TwelveDataService.js";
import type { Candle } from "./TwelveDataService.js";

export type TrendDirection = "BUY" | "SELL";
export type MarketState = "TRENDING" | "TRANSITION" | "RANGING";
export type SignalStrength = "strong" | "moderate" | "swing" | "weak" | "ranging";

export interface TrendData {
  direction: TrendDirection;
  structure: "HH-HL" | "LH-LL" | "RANGE";
  explanation: string;
  strength: SignalStrength;
  marketState: MarketState;
  rsi: number;
  adx: number;
  emaFast: number;
  emaSlow: number;
  currentPrice: number;
  candleTime: string;
}

export const SUPPORTED_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

const MIN_CANDLES = 55;

/**
 * Analyze only confirmed candles, ordered oldest → newest.
 *
 * A full structure requires two confirmed swing highs and two confirmed swing
 * lows. A pivot uses two candles on each side, so the newest 2 candles cannot
 * be used as pivots until they are confirmed.
 */
export function analyzeTrendFromCandles(candles: Candle[]): TrendData {
  if (candles.length === 0) {
    throw new Error("Cannot analyze an empty candle series");
  }

  const usable = candles.length > MIN_CANDLES
    ? candles.slice(-Math.max(MIN_CANDLES, candles.length))
    : candles;
  const n = usable.length;
  const last = usable[n - 1];
  const atr = calcATR(usable, 14);
  const emaFastSeries = calcEMA(usable, 20);
  const emaSlowSeries = calcEMA(usable, 50);
  const emaFast = emaFastSeries[n - 1];
  const emaSlow = emaSlowSeries[n - 1];
  const slopeIndex = Math.max(0, n - 6);
  const fastSlope = emaFast - emaFastSeries[slopeIndex];
  const slowSlope = emaSlow - emaSlowSeries[slopeIndex];
  const rsi = calcRSI(usable, 14);
  const adx = calcADX(usable, 14);

  const swingHighs = findSwingHighs(usable, 2, atr, 0.25);
  const swingLows = findSwingLows(usable, 2, atr, 0.25);

  const hhhl =
    swingHighs.length >= 2 &&
    swingLows.length >= 2 &&
    swingHighs.at(-1)! > swingHighs.at(-2)! &&
    swingLows.at(-1)! > swingLows.at(-2)!;
  const lhll =
    swingHighs.length >= 2 &&
    swingLows.length >= 2 &&
    swingHighs.at(-1)! < swingHighs.at(-2)! &&
    swingLows.at(-1)! < swingLows.at(-2)!;

  const structureDirection: TrendDirection | null = hhhl ? "BUY" : lhll ? "SELL" : null;
  const emaDirection: TrendDirection | null =
    emaFast > emaSlow && last.close > emaSlow && fastSlope > 0 && slowSlope >= 0
      ? "BUY"
      : emaFast < emaSlow && last.close < emaSlow && fastSlope < 0 && slowSlope <= 0
        ? "SELL"
        : null;
  const momentumDirection: TrendDirection | null =
    rsi >= 52 ? "BUY" : rsi <= 48 ? "SELL" : null;

  const structureScore = structureDirection === "BUY" ? 2 : structureDirection === "SELL" ? -2 : 0;
  const emaScore = emaDirection === "BUY" ? 2 : emaDirection === "SELL" ? -2 : 0;
  const momentumScore = momentumDirection === "BUY" ? 1 : momentumDirection === "SELL" ? -1 : 0;
  const score = structureScore + emaScore + momentumScore;

  let direction: TrendDirection;
  if (structureDirection) {
    direction = structureDirection;
  } else if (emaDirection) {
    direction = emaDirection;
  } else if (momentumDirection) {
    direction = momentumDirection;
  } else {
    direction = emaFast >= emaSlow ? "BUY" : "SELL";
  }

  const allTrendEvidenceAgrees =
    structureDirection === direction &&
    emaDirection === direction &&
    momentumDirection === direction;
  const hasDirectConflict =
    structureDirection !== null &&
    emaDirection !== null &&
    structureDirection !== emaDirection;

  let marketState: MarketState;
  let strength: SignalStrength;
  if (adx < 18 || Math.abs(score) <= 1) {
    marketState = "RANGING";
    strength = "ranging";
  } else if (hasDirectConflict) {
    marketState = "TRANSITION";
    strength = "weak";
  } else {
    marketState = "TRENDING";
    strength = allTrendEvidenceAgrees || (adx >= 25 && Math.abs(score) >= 4)
      ? "strong"
      : Math.abs(score) >= 3 ? "moderate" : "swing";
  }

  const structure = hhhl ? "HH-HL" : lhll ? "LH-LL" : "RANGE";

  return {
    direction,
    structure,
    explanation: buildExplanation({
      direction,
      structure,
      marketState,
      strength,
      rsi,
      adx,
      structureDirection,
      emaDirection,
      momentumDirection,
    }),
    strength,
    marketState,
    rsi: Number(rsi.toFixed(1)),
    adx: Number(adx.toFixed(1)),
    emaFast: Number(emaFast.toFixed(5)),
    emaSlow: Number(emaSlow.toFixed(5)),
    currentPrice: Number(last.close.toFixed(5)),
    candleTime: last.datetime,
  };
}

function buildExplanation(args: {
  direction: TrendDirection;
  structure: "HH-HL" | "LH-LL" | "RANGE";
  marketState: MarketState;
  strength: SignalStrength;
  rsi: number;
  adx: number;
  structureDirection: TrendDirection | null;
  emaDirection: TrendDirection | null;
  momentumDirection: TrendDirection | null;
}): string {
  const {
    direction,
    structure,
    marketState,
    strength,
    rsi,
    adx,
    structureDirection,
    emaDirection,
    momentumDirection,
  } = args;

  if (marketState === "RANGING") {
    return `Pasar RANGING, bukan tren bersih. Struktur ${structure}; ADX ${adx.toFixed(0)} dan RSI ${rsi.toFixed(0)}. Hindari entry sampai breakout dan retest terkonfirmasi.`;
  }
  if (marketState === "TRANSITION") {
    return `Pasar TRANSITION: struktur ${structureDirection ?? "belum jelas"} berlawanan dengan EMA. RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Jangan mengejar harga; tunggu struktur dan EMA kembali searah.`;
  }
  if (strength === "strong") {
    return direction === "BUY"
      ? `Tren BUY kuat: struktur HH-HL, EMA20 di atas EMA50, RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Konfirmasi multi-faktor searah.`
      : `Tren SELL kuat: struktur LH-LL, EMA20 di bawah EMA50, RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Konfirmasi multi-faktor searah.`;
  }
  if (strength === "moderate") {
    return direction === "BUY"
      ? `Bias BUY moderat: EMA dan momentum mendukung. Struktur ${structure}; RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Tunggu pullback dan candle konfirmasi.`
      : `Bias SELL moderat: EMA dan momentum mendukung. Struktur ${structure}; RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Tunggu rally dan candle konfirmasi.`;
  }
  return direction === "BUY"
    ? `Struktur HH-HL mulai terlihat, tetapi konfirmasi belum lengkap. EMA: ${emaDirection ?? "netral"}, RSI: ${momentumDirection ?? "netral"}.`
    : `Struktur LH-LL mulai terlihat, tetapi konfirmasi belum lengkap. EMA: ${emaDirection ?? "netral"}, RSI: ${momentumDirection ?? "netral"}.`;
}