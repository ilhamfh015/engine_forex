/**
 * TradeSetupService
 *
 * Calculates optimal trade setup levels from real candle data:
 *   - Entry Zone  : price range where risk/reward is most favourable
 *   - Stop Loss   : placed beyond the last structural swing + ATR buffer
 *   - TP1 / TP2 / TP3 : projected targets at 1:1, 1:2, 1:3 RR
 *
 * All levels rounded to instrument-specific decimal places.
 */

import type { Candle } from "./TwelveDataService.js";
import { calcATR, findSwingHighs, findSwingLows, calcEMA, PRICE_DECIMALS, PIP_SIZE } from "./TwelveDataService.js";
import type { TrendDirection } from "./MarketStructureService.js";

export interface TradeSetup {
  direction: TrendDirection;
  /** Lower bound of the ideal entry zone */
  entryZoneMin: number;
  /** Upper bound of the ideal entry zone */
  entryZoneMax: number;
  /** Status label shown to the user */
  entryZoneLabel: string;
  /** Stop-loss price */
  stopLoss: number;
  /** Take-profit level 1 (1:1 RR) */
  tp1: number;
  /** Take-profit level 2 (1:2 RR) */
  tp2: number;
  /** Take-profit level 3 (1:3 RR or next key swing) */
  tp3: number;
  /** Reward:Risk ratio using current price */
  riskRewardRatio: number;
  /** Risk in price points (SL distance from entry zone mid) */
  riskPoints: number;
  /** Pip/point size for this instrument */
  pipSize: number;
}

/**
 * Builds a full trade setup from M15 candles.
 *
 * @param pair     - Instrument (EURUSD, etc.)
 * @param direction - Bias from H1 trend analysis
 * @param candles  - M15 OHLCV candles (oldest → newest, ≥ 30 recommended)
 */
export function buildTradeSetup(
  pair: string,
  direction: TrendDirection,
  candles: Candle[],
): TradeSetup {
  const n = candles.length;
  const currentPrice = candles[n - 1].close;
  const atr = calcATR(candles, 14);
  const pipSize = PIP_SIZE[pair] ?? 0.0001;
  const decimals = PRICE_DECIMALS[pair] ?? 5;
  const fix = (v: number) => parseFloat(v.toFixed(decimals));

  // EMA21 = "fair value" zone anchor
  const ema21arr = calcEMA(candles, 21);
  const ema21 = ema21arr[n - 1];

  // Swing levels (size-filtered)
  const swingHighs = findSwingHighs(candles, 2, atr, 0.3);
  const swingLows = findSwingLows(candles, 2, atr, 0.3);

  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : currentPrice - 2 * atr;
  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : currentPrice + 2 * atr;

  // ── Entry Zone ─────────────────────────────────────────────────────────────
  // BUY zone: from last swing low up to EMA21 + small buffer (value area)
  // SELL zone: from EMA21 - buffer down to last swing high (resistance area)
  let entryZoneMin: number;
  let entryZoneMax: number;

  if (direction === "BUY") {
    entryZoneMin = fix(Math.max(lastSwingLow + atr * 0.1, ema21 - atr * 1.0));
    entryZoneMax = fix(ema21 + atr * 0.5);
  } else {
    entryZoneMin = fix(ema21 - atr * 0.5);
    entryZoneMax = fix(Math.min(lastSwingHigh - atr * 0.1, ema21 + atr * 1.0));
  }

  // Ensure min < max (safety clamp)
  if (entryZoneMin >= entryZoneMax) {
    entryZoneMin = fix(currentPrice - atr * 0.5);
    entryZoneMax = fix(currentPrice + atr * 0.5);
  }

  // Entry zone label based on current price position
  const entryZoneLabel = buildEntryLabel(direction, currentPrice, entryZoneMin, entryZoneMax);

  // ── Stop Loss ──────────────────────────────────────────────────────────────
  // Buffer = 0.3 ATR beyond last structural swing
  let stopLoss: number;
  if (direction === "BUY") {
    stopLoss = fix(lastSwingLow - atr * 0.3);
  } else {
    stopLoss = fix(lastSwingHigh + atr * 0.3);
  }

  // ── Entry mid for RR calculation ───────────────────────────────────────────
  // Use zone midpoint as the reference entry
  const entryMid = (entryZoneMin + entryZoneMax) / 2;
  const risk = direction === "BUY"
    ? entryMid - stopLoss
    : stopLoss - entryMid;

  const safeRisk = Math.max(risk, atr * 0.5); // floor risk to avoid division by zero

  // ── Take Profits ───────────────────────────────────────────────────────────
  let tp1: number;
  let tp2: number;
  let tp3: number;

  if (direction === "BUY") {
    tp1 = fix(entryMid + safeRisk * 1.0);
    tp2 = fix(entryMid + safeRisk * 2.0);

    // TP3: next swing HIGH above current OR 3× risk projection
    const nextSwingAbove = [...swingHighs].reverse().find((h) => h > currentPrice + atr * 0.5);
    tp3 = fix(nextSwingAbove !== undefined && nextSwingAbove > tp2
      ? nextSwingAbove
      : entryMid + safeRisk * 3.0);
  } else {
    tp1 = fix(entryMid - safeRisk * 1.0);
    tp2 = fix(entryMid - safeRisk * 2.0);

    // TP3: next swing LOW below current OR 3× risk projection
    const nextSwingBelow = [...swingLows].reverse().find((l) => l < currentPrice - atr * 0.5);
    tp3 = fix(nextSwingBelow !== undefined && nextSwingBelow < tp2
      ? nextSwingBelow
      : entryMid - safeRisk * 3.0);
  }

  // ── RR Ratio (from current price to TP2 / risk) ───────────────────────────
  const rewardAtTP2 = direction === "BUY"
    ? tp2 - currentPrice
    : currentPrice - tp2;
  const currentRisk = direction === "BUY"
    ? currentPrice - stopLoss
    : stopLoss - currentPrice;
  const riskRewardRatio = currentRisk > 0
    ? parseFloat((rewardAtTP2 / currentRisk).toFixed(2))
    : 0;

  return {
    direction,
    entryZoneMin,
    entryZoneMax,
    entryZoneLabel,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio,
    riskPoints: parseFloat(safeRisk.toFixed(decimals)),
    pipSize,
  };
}

function buildEntryLabel(
  direction: TrendDirection,
  currentPrice: number,
  zoneMin: number,
  zoneMax: number,
): string {
  if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
    return "✅ IN ZONE — BISA ENTRY SEKARANG";
  }
  if (direction === "BUY") {
    return currentPrice > zoneMax
      ? "⏳ TUNGGU PULLBACK KE ZONA"
      : "⚠️ HARGA DI BAWAH ZONA — KONFIRMASI BOUNCE";
  } else {
    return currentPrice < zoneMin
      ? "⏳ TUNGGU RALLY KE ZONA"
      : "⚠️ HARGA DI ATAS ZONA — KONFIRMASI REJECTION";
  }
}
