import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { TradeSetup } from "./TradeSetupService.js";
import {
  runConfidenceBacktest,
  scoreBand,
  simulateLimitOrder,
} from "./ConfidenceBacktestService.js";
import type { Candle } from "./TwelveDataService.js";

function candle(datetime: string, open: number, high: number, low: number, close: number): Candle {
  return { datetime, open, high, low, close, volume: 0 };
}

function syntheticSeries(
  count: number,
  intervalMinutes: number,
  startTime: number,
  basePrice: number,
): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const time = new Date(startTime + index * intervalMinutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
    const open = basePrice + index * 0.000001 + Math.sin(index / 12) * 0.001;
    const close = basePrice + (index + 1) * 0.000001 + Math.sin((index + 1) / 12) * 0.001;
    const spread = 0.00025 + Math.abs(Math.sin(index / 4)) * 0.00008;
    return candle(time, open, Math.max(open, close) + spread, Math.min(open, close) - spread, close);
  });
}

test("score bands cover the full heuristic range", () => {
  assert.equal(scoreBand(0), "0-39");
  assert.equal(scoreBand(39), "0-39");
  assert.equal(scoreBand(40), "40-59");
  assert.equal(scoreBand(60), "60-79");
  assert.equal(scoreBand(80), "80-100");
  assert.equal(scoreBand(100), "80-100");
});

test("ambiguous same-candle stop and target uses the conservative stop result", () => {
  const setup: TradeSetup = {
    direction: "BUY",
    status: "READY",
    statusReason: "",
    currentPrice: 100,
    entryZoneMin: 99.5,
    entryZoneMax: 100.5,
    entryPrice: 100,
    entryZoneLabel: "",
    stopLoss: 99,
    tp1: 101,
    tp2: 102,
    tp3: 103,
    riskRewardRatio: 2,
    riskPoints: 1,
    pipSize: 0.0001,
  };
  const bars = [
    candle("2026-01-01 00:00:00", 100, 101, 99, 100),
    candle("2026-01-01 00:15:00", 100, 103, 98, 101),
    candle("2026-01-01 00:30:00", 101, 102, 100, 101),
  ];

  const outcome = simulateLimitOrder(bars, 0, bars.length, setup, 2, 2);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.trade?.grossR, -1);
  assert.equal(outcome.trade?.exitIndex, 1);
});

test("target return is measured against the actual entry-to-stop distance", () => {
  const setup: TradeSetup = {
    direction: "BUY",
    status: "READY",
    statusReason: "",
    currentPrice: 100,
    entryZoneMin: 99.5,
    entryZoneMax: 100.5,
    entryPrice: 100,
    entryZoneLabel: "",
    stopLoss: 99.5,
    tp1: 101,
    tp2: 102,
    tp3: 103,
    riskRewardRatio: 2,
    riskPoints: 1,
    pipSize: 0.0001,
  };
  const bars = [
    candle("2026-01-01 00:00:00", 100, 101, 99, 100),
    candle("2026-01-01 00:15:00", 100, 102.1, 99.8, 101),
    candle("2026-01-01 00:30:00", 101, 102, 100, 101),
  ];

  const outcome = simulateLimitOrder(bars, 0, bars.length, setup, 2, 2);
  assert.equal(outcome.trade?.grossR, 4);
});

test("historical replay produces separate chronological calibration and holdout reports", () => {
  const m15Start = Date.UTC(2026, 0, 10);
  const h1 = syntheticSeries(360, 60, m15Start - 180 * 60 * 60_000, 1.08);
  const m15 = syntheticSeries(800, 15, m15Start, 1.08);

  const report = runConfidenceBacktest("EURUSD", m15, h1);

  assert.equal(report.candlesM15, 799);
  assert.equal(report.scenarios.length, 2);
  assert.deepEqual(report.scenarios[0].periods.map((period) => period.name), ["calibration", "out-of-sample"]);
  assert.equal(report.scenarios[1].scoreScenario, "news-unavailable");
  assert.ok(Date.parse(report.scenarios[0].periods[0].to) < Date.parse(report.scenarios[0].periods[1].from));
  assert.ok(report.scenarios[0].periods.every((period) => period.buckets.length === 4));
  assert.ok(report.scenarios[0].periods[0].buckets.reduce((sum, bucket) => sum + bucket.signals, 0) > 0);
});
