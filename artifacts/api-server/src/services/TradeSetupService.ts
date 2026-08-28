/**
 * TradeSetupService
 *
 * Produces a plan, not a blind market order:
 *   - entry zone around the M15 EMA20/value area
 *   - stop beyond the latest confirmed structural swing plus ATR buffer
 *   - TP1/TP2/TP3 at 1R/2R/3R, capped by the next opposing swing when useful
 *
 * The setup is marked WAIT when price is not in the zone. It is also marked
 * NO_TRADE when H1/M15 are not aligned or either timeframe is not trending.
 */

import type { Candle } from "./TwelveDataService.js";
import {
  calcATR,
  calcEMA,
  findSwingHighs,
  findSwingLows,
  PIP_SIZE,
  PRICE_DECIMALS,
} from "./TwelveDataService.js";
import type { MarketState, TrendDirection } from "./MarketStructureService.js";

export type TradeSetupStatus = "READY" | "WAIT" | "NO_TRADE";

export interface TradeSetup {
  direction: TrendDirection;
  status: TradeSetupStatus;
  statusReason: string;
  currentPrice: number;
  entryZoneMin: number;
  entryZoneMax: number;
  entryPrice: number;
  entryZoneLabel: string;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  riskPoints: number;
  pipSize: number;
}

export function buildTradeSetup(
  pair: string,
  direction: TrendDirection,
  candles: Candle[],
  h1State: MarketState,
  m15State: MarketState,
  m15Direction: TrendDirection,
): TradeSetup {
  if (candles.length < 10) throw new Error("Not enough candles for a trade setup");

  const n = candles.length;
  const currentPrice = candles[n - 1].close;
  const atr = Math.max(calcATR(candles, 14), Number.EPSILON);
  const ema20 = calcEMA(candles, 20).at(-1)!;
  const decimals = PRICE_DECIMALS[pair] ?? 5;
  const pipSize = PIP_SIZE[pair] ?? 0.0001;
  const fix = (value: number) => Number(value.toFixed(decimals));

  const swingHighs = findSwingHighs(candles, 2, atr, 0.25);
  const swingLows = findSwingLows(candles, 2, atr, 0.25);
  const lastSwingLow = swingLows.at(-1);
  const lastSwingHigh = swingHighs.at(-1);

  // The zone is deliberately narrow: a pullback around EMA20, not the entire
  // distance to a swing. This avoids presenting an entry that is already late.
  const entryZoneMin = direction === "BUY"
    ? fix(ema20 - 0.35 * atr)
    : fix(ema20 - 0.15 * atr);
  const entryZoneMax = direction === "BUY"
    ? fix(ema20 + 0.15 * atr)
    : fix(ema20 + 0.35 * atr);
  const entryPrice = fix((entryZoneMin + entryZoneMax) / 2);

  // Structural invalidation. If no confirmed swing exists, use a conservative
  // ATR fallback rather than inventing a precise support/resistance level.
  const stopLoss = direction === "BUY"
    ? fix(Math.min(entryZoneMin - 0.2 * atr, (lastSwingLow ?? entryZoneMin - atr) - 0.2 * atr))
    : fix(Math.max(entryZoneMax + 0.2 * atr, (lastSwingHigh ?? entryZoneMax + atr) + 0.2 * atr));

  const risk = direction === "BUY"
    ? Math.max(entryPrice - stopLoss, 0.6 * atr)
    : Math.max(stopLoss - entryPrice, 0.6 * atr);

  const rawTp1 = direction === "BUY" ? entryPrice + risk : entryPrice - risk;
  const rawTp2 = direction === "BUY" ? entryPrice + 2 * risk : entryPrice - 2 * risk;
  const rawTp3 = direction === "BUY" ? entryPrice + 3 * risk : entryPrice - 3 * risk;

  // Use the nearest opposing swing as a realistic TP3 only when it is beyond TP2.
  const nextResistance = swingHighs
    .filter((high) => high > rawTp2)
    .sort((a, b) => a - b)[0];
  const nextSupport = swingLows
    .filter((low) => low < rawTp2)
    .sort((a, b) => b - a)[0];
  const tp1 = fix(rawTp1);
  const tp2 = fix(rawTp2);
  const tp3 = direction === "BUY"
    ? fix(nextResistance !== undefined ? Math.min(nextResistance, rawTp3) : rawTp3)
    : fix(nextSupport !== undefined ? Math.max(nextSupport, rawTp3) : rawTp3);

  // RR must describe the proposed plan (zone midpoint → TP2), not the
  // current price while the setup is waiting for a pullback/rally.
  const riskRewardRatio = Number(
    ((direction === "BUY" ? tp2 - entryPrice : entryPrice - tp2) / risk).toFixed(2),
  );

  const aligned = h1State === "TRENDING" && m15State === "TRENDING" && direction === m15Direction;
  const inZone = currentPrice >= entryZoneMin && currentPrice <= entryZoneMax;
  let status: TradeSetupStatus;
  let statusReason: string;

  if (!aligned) {
    status = "NO_TRADE";
    statusReason = "H1 dan M15 belum sama-sama trending dan searah. Tunggu konfluensi sebelum entry.";
  } else if (inZone) {
    status = "READY";
    statusReason = "Harga berada di zona value. Tetap tunggu candle rejection/confirmation sebelum eksekusi.";
  } else {
    status = "WAIT";
    statusReason = direction === "BUY"
      ? "Harga terlalu jauh di atas zona value. Tunggu pullback ke area entry."
      : "Harga terlalu jauh di bawah zona value. Tunggu rally ke area entry.";
  }

  return {
    direction,
    status,
    statusReason,
    currentPrice: fix(currentPrice),
    entryZoneMin,
    entryZoneMax,
    entryPrice,
    entryZoneLabel: status === "NO_TRADE"
      ? "NO TRADE — TUNGGU KONFLUENSI"
      : status === "READY"
        ? "READY — KONFIRMASI CANDLE"
        : direction === "BUY"
          ? "WAIT — TUNGGU PULLBACK"
          : "WAIT — TUNGGU RALLY",
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio,
    riskPoints: fix(risk),
    pipSize,
  };
}