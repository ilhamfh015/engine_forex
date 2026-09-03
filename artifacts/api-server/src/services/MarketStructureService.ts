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
  calcATR,
  calcEMA,
  calcDMI,
  calcRSI,
  findSwingHighPoints,
  findSwingLowPoints,
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
  diPlus: number;
  diMinus: number;
  adxSlope: number;
  emaFast: number;
  emaSlow: number;
  currentPrice: number;
  candleTime: string;
}

export const SUPPORTED_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

const MAX_ANALYSIS_CANDLES = 100;
const STRUCTURE_WINDOW = 64;
const MAX_PIVOT_AGE = 32;
const MIN_STRUCTURE_CHANGE_ATR = 0.2;
const MIN_EMA_SEPARATION_ATR = 0.15;
const MIN_EMA_SLOPE_ATR = 0.05;
const MIN_DI_SEPARATION = 3;
const MIN_TREND_ADX = 20;

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

  const usable = candles.length > MAX_ANALYSIS_CANDLES
    ? candles.slice(-MAX_ANALYSIS_CANDLES)
    : candles;
  const n = usable.length;
  const last = usable[n - 1];
  const atr = calcATR(usable, 14);
  const emaFastSeries = calcEMA(usable, 20);
  const emaSlowSeries = calcEMA(usable, 50);
  const emaFast = emaFastSeries[n - 1];
  const emaSlow = emaSlowSeries[n - 1];
  const slopeIndex = Math.max(0, n - 6);
  // Normalize EMA slopes by ATR so the same thresholds work for FX, gold,
  // JPY pairs, and crypto instead of using instrument-specific raw prices.
  const fastSlopeAtr = atr > 0 ? (emaFast - emaFastSeries[slopeIndex]) / atr : 0;
  const slowSlopeAtr = atr > 0 ? (emaSlow - emaSlowSeries[slopeIndex]) / atr : 0;
  const emaSpreadAtr = atr > 0 ? (emaFast - emaSlow) / atr : 0;
  const rsi = calcRSI(usable, 14);
  const dmi = calcDMI(usable, 14);
  const adx = dmi.adx;

  // Ignore old pivots from a previous regime. A trend is only valid when its
  // latest structural evidence is recent enough to describe current price.
  const swingHighs = findSwingHighPoints(usable, 2, atr, 0.3)
    .filter((point) => point.index >= n - STRUCTURE_WINDOW);
  const swingLows = findSwingLowPoints(usable, 2, atr, 0.3)
    .filter((point) => point.index >= n - STRUCTURE_WINDOW);
  const lastHigh = swingHighs.at(-1);
  const previousHigh = swingHighs.at(-2);
  const lastLow = swingLows.at(-1);
  const previousLow = swingLows.at(-2);
  const pivotsAreRecent =
    !!lastHigh &&
    !!lastLow &&
    lastHigh.index >= n - MAX_PIVOT_AGE &&
    lastLow.index >= n - MAX_PIVOT_AGE;

  const hhhl =
    pivotsAreRecent &&
    !!previousHigh &&
    !!previousLow &&
    lastHigh.price > previousHigh.price + MIN_STRUCTURE_CHANGE_ATR * atr &&
    lastLow.price > previousLow.price + MIN_STRUCTURE_CHANGE_ATR * atr;
  const lhll =
    pivotsAreRecent &&
    !!previousHigh &&
    !!previousLow &&
    lastHigh.price < previousHigh.price - MIN_STRUCTURE_CHANGE_ATR * atr &&
    lastLow.price < previousLow.price - MIN_STRUCTURE_CHANGE_ATR * atr;

  const structureDirection: TrendDirection | null = hhhl ? "BUY" : lhll ? "SELL" : null;
  const emaDirection: TrendDirection | null =
    emaSpreadAtr >= MIN_EMA_SEPARATION_ATR &&
    last.close > emaSlow &&
    fastSlopeAtr >= MIN_EMA_SLOPE_ATR &&
    slowSlopeAtr >= -0.02
      ? "BUY"
      : emaSpreadAtr <= -MIN_EMA_SEPARATION_ATR &&
        last.close < emaSlow &&
        fastSlopeAtr <= -MIN_EMA_SLOPE_ATR &&
        slowSlopeAtr <= 0.02
        ? "SELL"
        : null;
  const momentumDirection: TrendDirection | null =
    rsi >= 55 ? "BUY" : rsi <= 45 ? "SELL" : null;
  const dmiDirection: TrendDirection | null =
    dmi.plusDI >= dmi.minusDI + MIN_DI_SEPARATION
      ? "BUY"
      : dmi.minusDI >= dmi.plusDI + MIN_DI_SEPARATION
        ? "SELL"
        : null;

  const structureScore = structureDirection === "BUY" ? 2 : structureDirection === "SELL" ? -2 : 0;
  const emaScore = emaDirection === "BUY" ? 2 : emaDirection === "SELL" ? -2 : 0;
  const momentumScore = momentumDirection === "BUY" ? 1 : momentumDirection === "SELL" ? -1 : 0;
  const dmiScore = dmiDirection === "BUY" ? 1 : dmiDirection === "SELL" ? -1 : 0;
  const score = structureScore + emaScore + momentumScore + dmiScore;

  // Direction follows weighted consensus. This prevents a stale pivot from
  // overriding a current EMA/DMI regime.
  const direction: TrendDirection = score > 0
    ? "BUY"
    : score < 0
      ? "SELL"
      : emaFast >= emaSlow ? "BUY" : "SELL";

  const structuralEvidence = [structureDirection, emaDirection, dmiDirection];
  const supportingSignals = [structureDirection, emaDirection, momentumDirection, dmiDirection]
    .filter((value) => value === direction).length;
  const hardConflict = structuralEvidence.some(
    (value, index) => value !== null && structuralEvidence.slice(index + 1).some((other) => other !== null && other !== value),
  );
  const consensus =
    supportingSignals >= 3 &&
    !hardConflict &&
    (momentumDirection === null || momentumDirection === direction);
  const losingStrength = dmi.adxSlope <= -3 && adx < 25;

  let marketState: MarketState;
  let strength: SignalStrength;
  if (adx < MIN_TREND_ADX || Math.abs(score) < 2 || supportingSignals < 2) {
    marketState = "RANGING";
    strength = "ranging";
  } else if (hardConflict || losingStrength) {
    marketState = "TRANSITION";
    strength = "weak";
  } else {
    marketState = "TRENDING";
    strength = consensus || (adx >= 25 && Math.abs(score) >= 4 && supportingSignals >= 3)
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
       diPlus: dmi.plusDI,
       diMinus: dmi.minusDI,
      structureDirection,
      emaDirection,
      momentumDirection,
       dmiDirection,
    }),
    strength,
    marketState,
    rsi: Number(rsi.toFixed(1)),
    adx: Number(adx.toFixed(1)),
    diPlus: Number(dmi.plusDI.toFixed(1)),
    diMinus: Number(dmi.minusDI.toFixed(1)),
    adxSlope: Number(dmi.adxSlope.toFixed(1)),
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
  diPlus: number;
  diMinus: number;
  structureDirection: TrendDirection | null;
  emaDirection: TrendDirection | null;
  momentumDirection: TrendDirection | null;
  dmiDirection: TrendDirection | null;
}): string {
  const {
    direction,
    structure,
    marketState,
    strength,
    rsi,
    adx,
    diPlus,
    diMinus,
    structureDirection,
    emaDirection,
    momentumDirection,
    dmiDirection,
  } = args;

  if (marketState === "RANGING") {
    return `Pasar RANGING, bukan tren bersih. Struktur ${structure}; ADX ${adx.toFixed(0)}, DI+ ${diPlus.toFixed(0)}, DI- ${diMinus.toFixed(0)}, RSI ${rsi.toFixed(0)}. Hindari entry sampai breakout dan retest terkonfirmasi.`;
  }
  if (marketState === "TRANSITION") {
    return `Pasar TRANSITION: struktur ${structureDirection ?? "belum jelas"}, EMA ${emaDirection ?? "netral"}, DMI ${dmiDirection ?? "netral"}. RSI ${rsi.toFixed(0)}, ADX ${adx.toFixed(0)}. Jangan mengejar harga; tunggu struktur, EMA, dan DMI kembali searah.`;
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