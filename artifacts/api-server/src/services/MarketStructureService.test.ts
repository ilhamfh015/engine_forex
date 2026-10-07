import assert from "node:assert/strict";
import test from "node:test";
import { applySetupAdvisory, buildTradeSetup } from "./TradeSetupService.js";
import {
  calcDMI,
  calcEMA,
  getClosedCandles,
  type Candle,
} from "./TwelveDataService.js";
import { analyzeTrendFromCandles } from "./MarketStructureService.js";

/**
 * Close-only fixtures with deliberate swing points:
 * - every fourth candle alternates between a swing and a pullback;
 * - the later swing highs and lows form HH-HL;
 * - mirroring prices around 200 forms LH-LL.
 *
 * Keeping OHLC bodies flat makes the fixture's high/low structure explicit
 * and avoids an opening price accidentally tying the preceding high/low.
 */
const BULLISH_CLOSES = [
  100, 100.1, 100.2, 100.1, 100.0,
  100.4, 100.8, 100.5, 100.3,
  100.9, 101.3, 101.0, 100.8,
  101.5, 101.9, 101.6, 101.4,
  102.1, 102.5, 102.2, 102.0,
  102.7, 103.1, 102.8, 102.6,
  103.3, 103.7, 103.4, 103.2,
  103.9, 104.3, 104.0, 103.8,
  104.5, 104.9, 104.6, 104.4,
  105.1, 105.5, 105.2, 105.0,
  105.7, 106.1, 105.8, 105.6,
];

const BEARISH_CLOSES = BULLISH_CLOSES.map((close) => 200 - (close - 100));

function makeCandles(closes: number[], prefix = "closed"): Candle[] {
  return closes.map((close, index) => ({
    datetime: `${prefix}-${String(index).padStart(3, "0")}`,
    open: close,
    high: close + 0.05,
    low: close - 0.05,
    close,
    volume: 1,
  }));
}

function assertFiniteNumbers(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} should be finite`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assertFiniteNumbers(child, `${path}.${key}`);
  }
}

test("bullish HH-HL structure with aligned EMA and DMI is TRENDING BUY", () => {
  const candles = makeCandles(BULLISH_CLOSES);
  const trend = analyzeTrendFromCandles(candles);
  const dmi = calcDMI(candles);
  const emaFast = calcEMA(candles, 20).at(-1)!;
  const emaSlow = calcEMA(candles, 50).at(-1)!;

  assert.equal(trend.direction, "BUY");
  assert.equal(trend.structure, "HH-HL");
  assert.equal(trend.marketState, "TRENDING");
  assert.ok(emaFast > emaSlow);
  assert.ok(dmi.plusDI > dmi.minusDI);
  assertFiniteNumbers(trend);
});

test("bearish LH-LL structure with aligned EMA and DMI is TRENDING SELL", () => {
  const candles = makeCandles(BEARISH_CLOSES);
  const trend = analyzeTrendFromCandles(candles);
  const dmi = calcDMI(candles);
  const emaFast = calcEMA(candles, 20).at(-1)!;
  const emaSlow = calcEMA(candles, 50).at(-1)!;

  assert.equal(trend.direction, "SELL");
  assert.equal(trend.structure, "LH-LL");
  assert.equal(trend.marketState, "TRENDING");
  assert.ok(emaFast < emaSlow);
  assert.ok(dmi.minusDI > dmi.plusDI);
  assertFiniteNumbers(trend);
});

test("conflicting structure and current EMA/DMI is never reported as TRENDING", () => {
  const bearishTail = Array.from({ length: 15 }, (_, index) => 105.6 - (index + 1) * 0.45);
  const candles = makeCandles([...BULLISH_CLOSES, ...bearishTail]);
  const trend = analyzeTrendFromCandles(candles);

  // The last confirmed pivots still describe the prior HH-HL structure, while
  // the current EMA/DMI regime has turned bearish.
  assert.equal(trend.structure, "HH-HL");
  assert.equal(trend.direction, "SELL");
  assert.notEqual(trend.marketState, "TRENDING");
  assert.ok(["TRANSITION", "RANGING"].includes(trend.marketState));
  assertFiniteNumbers(trend);
});

test("an unclosed last candle cannot change an already confirmed signal", () => {
  const confirmed = makeCandles(BULLISH_CLOSES);
  const forming = makeCandles([120], "forming")[0];
  const withFormingCandle = [...confirmed, {
    ...forming,
    open: confirmed.at(-1)!.close,
    high: 121,
    low: 99,
    close: 120,
  }];

  const confirmedTrend = analyzeTrendFromCandles(confirmed);
  const trendWithFormingCandle = analyzeTrendFromCandles(getClosedCandles(withFormingCandle));

  assert.deepEqual(trendWithFormingCandle, confirmedTrend);
  assert.equal(getClosedCandles(withFormingCandle).length, confirmed.length);
});

test("trade setup levels stay finite and ordered in the trade direction", () => {
  for (const [direction, closes] of [
    ["BUY", BULLISH_CLOSES],
    ["SELL", BEARISH_CLOSES],
  ] as const) {
    const setup = buildTradeSetup(
      "EURUSD",
      direction,
      makeCandles(closes),
      "TRENDING",
      "TRENDING",
      direction,
    );

    assertFiniteNumbers(setup);
    if (direction === "BUY") {
      assert.ok(setup.stopLoss < setup.entryPrice);
      assert.ok(setup.entryPrice < setup.tp1);
      assert.ok(setup.tp1 <= setup.tp2 && setup.tp2 <= setup.tp3);
    } else {
      assert.ok(setup.stopLoss > setup.entryPrice);
      assert.ok(setup.entryPrice > setup.tp1);
      assert.ok(setup.tp1 >= setup.tp2 && setup.tp2 >= setup.tp3);
    }
  }
});

test("misaligned trends and high news risk produce a caution, not NO_TRADE", () => {
  const base = buildTradeSetup(
    "EURUSD",
    "BUY",
    makeCandles(BULLISH_CLOSES),
    "RANGING",
    "TRENDING",
    "SELL",
  );
  const inZone = {
    ...base,
    currentPrice: (base.entryZoneMin + base.entryZoneMax) / 2,
  };
  const advisory = applySetupAdvisory(inZone, {
    score: 35,
    timeframeAligned: false,
    checklist: [
      { label: "Struktur HH-HL/LH-LL", passed: false, weight: 0.15 },
      { label: "DMI + ADX Mendukung", passed: false, weight: 0.15 },
      { label: "Confirmation Candle", passed: true, weight: 0.13 },
      { label: "Risk Reward Bagus", passed: true, weight: 0.05 },
    ],
    newsStatus: "HIGH_RISK",
  });

  assert.equal(advisory.status, "CAUTION");
  assert.match(advisory.entryZoneLabel, /CAUTION/);
  assert.match(advisory.statusReason, /tidak memblokir setup/i);
  assert.ok(Number.isFinite(advisory.entryPrice));
});