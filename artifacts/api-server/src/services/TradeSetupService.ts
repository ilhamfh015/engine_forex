/**
 * TradeSetupService
 *
 * Produces a plan, not a blind market order:
 *   - entry zone around the M15 EMA20/value area
 *   - stop beyond the latest confirmed structural swing plus ATR buffer
 *   - TP1/TP2/TP3 up to 1R/2R/3R, capped by the nearest opposing swing
 *
 * Readiness labels are advisory only: no market or news condition suppresses
 * the setup or blocks the response.
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
import type { ChecklistItem } from "./EntryConfidenceService.js";
import type { NewsRiskStatus } from "./NewsService.js";

export type TradeSetupStatus = "READY" | "WAIT" | "CAUTION";

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

export interface SetupAdvisory {
  score: number;
  timeframeAligned: boolean;
  checklist: ChecklistItem[];
  newsStatus: NewsRiskStatus;
}

/**
 * Keep the plan visible in every market state. Statuses describe risk/readiness
 * for the user; they are not execution gates.
 */
export function applySetupAdvisory(setup: TradeSetup, advisory: SetupAdvisory): TradeSetup {
  const check = (label: string) => advisory.checklist.find((item) => item.label === label)?.passed ?? false;
  const inZone = setup.currentPrice >= setup.entryZoneMin && setup.currentPrice <= setup.entryZoneMax;
  const confirmation = check("Confirmation Candle");
  const rr = check("Risk Reward Bagus");
  const coreChecks = [
    advisory.timeframeAligned,
    check("Struktur HH-HL/LH-LL"),
    check("DMI + ADX Mendukung"),
    rr,
  ];

  const status: TradeSetupStatus = !inZone || !confirmation
    ? "WAIT"
    : coreChecks.some((passed) => !passed) || advisory.newsStatus !== "CLEAR" || advisory.score < 70
      ? "CAUTION"
      : "READY";

  const warnings = [
    !advisory.timeframeAligned ? "H1/M15 belum searah dan sama-sama trending" : "",
    !check("Struktur HH-HL/LH-LL") ? "struktur swing belum mendukung penuh" : "",
    !check("DMI + ADX Mendukung") ? "DMI/ADX belum mendukung penuh" : "",
    !confirmation ? "tunggu candle konfirmasi yang lebih jelas" : "",
    !rr ? "RR rencana di bawah 1:1.5" : "",
    advisory.newsStatus === "HIGH_RISK" ? "risiko berita tinggi mengurangi skor, bukan memblokir setup" : "",
    advisory.newsStatus === "CAUTION" ? "ada risiko berita sedang" : "",
    advisory.newsStatus === "UNAVAILABLE" ? "data berita tidak lengkap; skor disesuaikan" : "",
    advisory.score < 70 ? `skor konfluensi ${advisory.score}/100` : "",
  ].filter(Boolean);

  const statusReason = status === "READY"
    ? "Konfluensi dan konfirmasi memadai. Ini tetap rekomendasi, bukan eksekusi otomatis."
    : [
        !inZone ? "Harga di luar zona entry ideal" : "",
        warnings.join("; "),
        "Peringatan ini tidak memblokir setup.",
      ].filter(Boolean).join(". ");

  return {
    ...setup,
    status,
    statusReason,
    entryZoneLabel: status === "READY"
      ? "READY — RENCANA TERKONFIRMASI"
      : status === "CAUTION"
        ? "CAUTION — REVIEW RISIKO"
        : "WAIT — TUNGGU ZONA/KONFIRMASI",
  };
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
  const structuralStop = direction === "BUY"
    ? fix(Math.min(entryZoneMin - 0.2 * atr, (lastSwingLow ?? entryZoneMin - atr) - 0.2 * atr))
    : fix(Math.max(entryZoneMax + 0.2 * atr, (lastSwingHigh ?? entryZoneMax + atr) + 0.2 * atr));

  const minimumRiskDistance = 0.6 * atr;
  const stopLoss = direction === "BUY"
    ? fix(Math.min(structuralStop, entryPrice - minimumRiskDistance))
    : fix(Math.max(structuralStop, entryPrice + minimumRiskDistance));
  const risk = Math.abs(entryPrice - stopLoss);

  const targetReference = direction === "BUY"
    ? Math.max(entryPrice, currentPrice)
    : Math.min(entryPrice, currentPrice);
  const nextResistance = swingHighs
    .filter((high) => high > targetReference)
    .sort((a, b) => a - b)[0];
  const nextSupport = swingLows
    .filter((low) => low < targetReference)
    .sort((a, b) => b - a)[0];
  const capTarget = (rawTarget: number) => {
    if (direction === "BUY" && nextResistance !== undefined) {
      return fix(Math.min(nextResistance, rawTarget));
    }
    if (direction === "SELL" && nextSupport !== undefined) {
      return fix(Math.max(nextSupport, rawTarget));
    }
    return fix(rawTarget);
  };
  const tp1 = capTarget(direction === "BUY" ? entryPrice + risk : entryPrice - risk);
  const tp2 = capTarget(direction === "BUY" ? entryPrice + 2 * risk : entryPrice - 2 * risk);
  const tp3 = capTarget(direction === "BUY" ? entryPrice + 3 * risk : entryPrice - 3 * risk);

  // RR describes the planned entry midpoint to TP2, including structural caps.
  const riskRewardRatio = Number(
    ((direction === "BUY" ? tp2 - entryPrice : entryPrice - tp2) / risk).toFixed(2),
  );

  const aligned = h1State === "TRENDING" && m15State === "TRENDING" && direction === m15Direction;
  const inZone = currentPrice >= entryZoneMin && currentPrice <= entryZoneMax;
  let status: TradeSetupStatus;
  let statusReason: string;

  if (!aligned) {
    status = "CAUTION";
    statusReason = "H1 dan M15 belum sama-sama trending dan searah. Rencana tetap ditampilkan dengan skor/peringatan.";
  } else if (inZone) {
    status = "READY";
    statusReason = "Harga berada di zona value. Periksa konfirmasi candle serta semua peringatan.";
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
    entryZoneLabel: status === "CAUTION"
      ? "CAUTION — REVIEW KONFLUENSI"
      : status === "READY"
        ? "READY — REVIEW KONFIRMASI"
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