import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTrendFromCandles,
} from "../src/services/MarketStructureService.js";
import {
  getClosedCandles,
} from "../src/services/TwelveDataService.js";
import type { Candle } from "../src/services/TwelveDataService.js";
import { calculateConfidence } from "../src/services/EntryConfidenceService.js";
import type { NewsRisk } from "../src/services/NewsService.js";
import type { TrendData } from "../src/services/MarketStructureService.js";

function makeSeries(direction: "BUY" | "SELL", count = 120): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const trend = direction === "BUY" ? index * 0.25 : -index * 0.25;
    const wave = Math.sin((index * Math.PI) / 4) * 0.9;
    const close = 100 + trend + wave;
    const open = close - (direction === "BUY" ? 0.12 : -0.12);
    return {
      datetime: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      open,
      high: Math.max(open, close) + 0.16,
      low: Math.min(open, close) - 0.16,
      close,
      volume: 1000,
    };
  });
}

test("detects a clean bullish structure with directional momentum", () => {
  const trend = analyzeTrendFromCandles(makeSeries("BUY"));

  assert.equal(trend.direction, "BUY");
  assert.equal(trend.marketState, "TRENDING");
  assert.ok(["HH-HL", "RANGE"].includes(trend.structure));
  assert.ok(trend.diPlus > trend.diMinus);
  assert.ok(Number.isFinite(trend.adx));
});

test("detects a clean bearish structure with directional momentum", () => {
  const trend = analyzeTrendFromCandles(makeSeries("SELL"));

  assert.equal(trend.direction, "SELL");
  assert.equal(trend.marketState, "TRENDING");
  assert.ok(trend.diMinus > trend.diPlus);
  assert.ok(Number.isFinite(trend.adx));
});

test("does not claim pivot structure that is not present", () => {
  const trend = analyzeTrendFromCandles(
    Array.from({ length: 120 }, (_, index) => {
      const close = 100 + index * 0.4;
      return {
        datetime: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
        open: close - 0.15,
        high: close + 0.2,
        low: close - 0.2,
        close,
        volume: 1000,
      };
    }),
  );

  assert.equal(trend.structure, "RANGE");
  assert.match(trend.explanation, /belum membentuk HH-HL/);
  assert.doesNotMatch(trend.explanation, /struktur HH-HL,/);
});

test("does not let a forming candle alter the confirmed series", () => {
  const confirmed = makeSeries("BUY");
  const formingCandle: Candle = {
    ...confirmed.at(-1)!,
    datetime: new Date(Date.UTC(2026, 0, 6)).toISOString(),
    open: 1000,
    high: 1000,
    low: 1,
    close: 1,
  };

  const baseline = analyzeTrendFromCandles(confirmed);
  const withFormingCandle = analyzeTrendFromCandles(
    getClosedCandles([...confirmed, formingCandle]),
  );

  assert.deepEqual(withFormingCandle, baseline);
});

test("returns finite indicator values for short but usable input", () => {
  const trend = analyzeTrendFromCandles(makeSeries("BUY", 55));

  for (const value of [
    trend.rsi,
    trend.adx,
    trend.diPlus,
    trend.diMinus,
    trend.adxSlope,
    trend.emaFast,
    trend.emaSlow,
    trend.currentPrice,
  ]) {
    assert.ok(Number.isFinite(value));
  }
});

function makeStrongTrend(): TrendData {
  return {
    direction: "BUY",
    structure: "HH-HL",
    explanation: "Strong bullish test trend",
    strength: "strong",
    marketState: "TRENDING",
    rsi: 58,
    adx: 28,
    diPlus: 31,
    diMinus: 16,
    adxSlope: 2,
    emaFast: 101,
    emaSlow: 100,
    currentPrice: 101.2,
    candleTime: new Date(Date.UTC(2026, 0, 6)).toISOString(),
  };
}

function makeNewsRisk(status: NewsRisk["status"]): NewsRisk {
  return {
    status,
    riskScore: status === "HIGH_RISK" ? 85 : status === "CLEAR" ? 0 : status === "CAUTION" ? 55 : 60,
    headline: status === "HIGH_RISK" ? "Central bank rate decision released" : "No high-impact headline",
    source: "test",
    fetchedAt: new Date(Date.UTC(2026, 0, 6)).toISOString(),
    windowMinutes: 180,
    items: [],
    upcomingEvents: [],
  };
}

test("high-impact news lowers the score but never hard-blocks an otherwise aligned setup", () => {
  const trend = makeStrongTrend();
  const candles = makeSeries("BUY");
  const clear = calculateConfidence("EURUSD", trend, trend, candles, 2, makeNewsRisk("CLEAR"));
  const highRisk = calculateConfidence("EURUSD", trend, trend, candles, 2, makeNewsRisk("HIGH_RISK"));
  const unavailable = calculateConfidence("EURUSD", trend, trend, candles, 2, makeNewsRisk("UNAVAILABLE"));

  assert.ok(highRisk.score < clear.score);
  assert.ok(unavailable.score < clear.score);
  assert.equal(highRisk.tradeAllowed, true);
  assert.equal(unavailable.tradeAllowed, true);
  assert.match(highRisk.note, /risiko berita tinggi/i);
  assert.match(highRisk.note, /tidak memblokir setup/i);
  assert.match(highRisk.note, /bukan probabilitas menang/i);
  assert.ok(highRisk.score >= 0 && highRisk.score <= 100);
});
