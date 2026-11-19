import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Candle } from "./TwelveDataService.js";
import { analyzeTrendFromCandles, type TrendData } from "./MarketStructureService.js";
import { DIRECTION_MODEL } from "./DirectionModelCoefficients.js";
import {
  DIRECTION_FEATURE_NAMES,
  extractDirectionFeatures,
  predictProbabilityUp,
  scoreDirection,
  sigmoid,
  strengthOf,
} from "./DirectionModelService.js";

function series(count: number, drift: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + drift * index;
    return {
      datetime: `2026-01-01T${String(index % 24).padStart(2, "0")}:00:00Z`,
      open: close - drift * 0.5,
      high: close + 0.05,
      low: close - 0.05,
      close,
      volume: 0,
    };
  });
}

function trend(overrides: Partial<TrendData> = {}): TrendData {
  return {
    direction: "BUY",
    structure: "HH-HL",
    explanation: "test",
    strength: "moderate",
    marketState: "TRENDING",
    rsi: 58,
    adx: 28,
    diPlus: 26,
    diMinus: 14,
    adxSlope: 1,
    emaFast: 100,
    emaSlow: 99,
    currentPrice: 100,
    candleTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("the compiled coefficients match the feature list", () => {
  const count = DIRECTION_MODEL.features.length;
  assert.ok(count > 0, "model artifact declares no features");
  assert.equal(DIRECTION_MODEL.weights.length, count, "weights are stale; rerun backtest:direction");
  assert.equal(DIRECTION_MODEL.means.length, count);
  assert.equal(DIRECTION_MODEL.stds.length, count);
  assert.ok(DIRECTION_MODEL.stds.every((std) => std > 0));
  assert.ok(DIRECTION_MODEL.validation.samples > 0, "validation block is empty");
  assert.ok(DIRECTION_MODEL.caveat.length > 0, "model must state the limit of its evidence");
});

test("every model feature is a known feature name", () => {
  const known = new Set<string>(DIRECTION_FEATURE_NAMES);
  for (const name of DIRECTION_MODEL.features) {
    assert.ok(known.has(name), `unknown feature in artifact: ${name}`);
  }
  assert.equal(new Set(DIRECTION_MODEL.features).size, DIRECTION_MODEL.features.length);
});

test("an uptrend produces a higher EMA-spread feature than a downtrend", () => {
  const up = extractDirectionFeatures(series(99, 0.12), series(99, 0.12), trend(), trend());
  const down = extractDirectionFeatures(
    series(99, -0.12),
    series(99, -0.12),
    trend({ direction: "SELL", structure: "LH-LL", diPlus: 14, diMinus: 26 }),
    trend({ direction: "SELL", structure: "LH-LL", diPlus: 14, diMinus: 26 }),
  );
  const emaSpread = DIRECTION_FEATURE_NAMES.indexOf("h1EmaSpread");
  assert.ok(up[emaSpread] > 0, `up spread ${up[emaSpread]}`);
  assert.ok(down[emaSpread] < 0, `down spread ${down[emaSpread]}`);
  assert.ok(up[emaSpread] > down[emaSpread]);
});

test("the score is the model probability, not a separate point total", () => {
  const candles = series(99, 0.08);
  const result = scoreDirection(candles, candles, trend(), trend());

  // Rebuild the logit from the published factor contributions.
  const rebuilt = DIRECTION_MODEL.intercept
    + result.factors.reduce((sum, factor) => sum + factor.contribution, 0);
  assert.ok(
    Math.abs(sigmoid(rebuilt) - result.probabilityUp) < 0.02,
    `rebuilt ${sigmoid(rebuilt)} vs ${result.probabilityUp}`,
  );
});

test("direction and score come from the same probability", () => {
  const candles = series(99, 0.05);
  const result = scoreDirection(candles, candles, trend(), trend());
  const expected = result.probabilityUp >= 0.5 ? "BUY" : "SELL";
  assert.equal(result.direction, expected);
  assert.ok(result.score >= 50 && result.score <= 100);
  const probabilityForDirection = result.direction === "BUY" ? result.probabilityUp : 1 - result.probabilityUp;
  assert.equal(result.score, Math.round(probabilityForDirection * 100));
});

test("factor labels are unique so the dashboard can key on them", () => {
  const candles = series(99, 0.05);
  const result = scoreDirection(candles, candles, trend(), trend());
  assert.equal(result.factors.length, DIRECTION_MODEL.features.length);
  assert.equal(new Set(result.factors.map((factor) => factor.label)).size, result.factors.length);
});

test("strength labels follow the compiled cutoffs", () => {
  assert.equal(strengthOf(DIRECTION_MODEL.strongCutoff), "Kuat");
  assert.equal(strengthOf(DIRECTION_MODEL.strongCutoff - 1), "Sedang");
  assert.equal(strengthOf(DIRECTION_MODEL.mediumCutoff - 1), "Lemah");
});

test("degenerate feature vectors still produce a usable probability", () => {
  const p = predictProbabilityUp(new Array(DIRECTION_FEATURE_NAMES.length).fill(0));
  assert.ok(Number.isFinite(p) && p > 0 && p < 1);
});

test("a still-forming H1 candle would change the answer, so windows stay aligned", () => {
  // Guard against accidentally passing an unclosed candle: the last feature
  // must react when the newest bar moves.
  const base = series(99, 0.1);
  const extended = base.slice(0, -1).concat({
    ...base[base.length - 1],
    close: base[base.length - 1].close + 2,
    high: base[base.length - 1].high + 2,
  });
  const a = extractDirectionFeatures(base, base, trend(), trend());
  const b = extractDirectionFeatures(extended, extended, trend(), trend());
  assert.notDeepEqual(a, b);
});

test("the real trend analyser drives the model without throwing", () => {
  const candles = series(99, 0.1);
  const h1 = analyzeTrendFromCandles(candles);
  const m15 = analyzeTrendFromCandles(candles);
  const result = scoreDirection(candles, candles, h1, m15);
  assert.equal(result.horizonBars, DIRECTION_MODEL.horizonBars);
  assert.equal(result.horizonHours, DIRECTION_MODEL.horizonBars / 4);
  assert.match(result.note, /Prediksi arah/);
  assert.ok(result.note.includes(DIRECTION_MODEL.caveat), "the caveat must reach the user-facing note");
});
