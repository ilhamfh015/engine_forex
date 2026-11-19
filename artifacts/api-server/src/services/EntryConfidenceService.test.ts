import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyScoreAdvisories, scoreToLevel, SCORING_WEIGHTS } from "./EntryConfidenceService.js";

test("scoring weights sum to one so a perfect setup reaches 100", () => {
  const total = Object.values(SCORING_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test("unstable factors stay visible but carry no score weight", () => {
  // Structure and momentum did not keep the same sign across the calibration
  // split and the holdout, so they must never move the score.
  assert.equal(SCORING_WEIGHTS.structure, 0);
  assert.equal(SCORING_WEIGHTS.momentum, 0);
});

test("news carries no weight because the replay could not validate it", () => {
  // The backtest only has a news-neutral scenario, where the old 0.10 weight
  // was a constant +10 for every trade. Risk is an advisory now.
  assert.equal(SCORING_WEIGHTS.news, 0);
  assert.ok(SCORING_WEIGHTS.entryFreshness > 0);
});

test("weight sits with the factors that were positive in both splits", () => {
  // DMI, value zone, and reward/risk carry the bulk of the weight. The partial
  // credit and freshness changes moved the fitted ordering, but value zone and
  // DMI stay in the same range instead of one dominating.
  assert.ok(SCORING_WEIGHTS.valueZone >= 0.2);
  assert.ok(SCORING_WEIGHTS.dmi >= 0.2);
  assert.ok(SCORING_WEIGHTS.rewardRisk >= 0.15);
  assert.ok(SCORING_WEIGHTS.alignment >= 0.15);
  assert.ok(SCORING_WEIGHTS.confirmation >= 0.05);
});

test("confidence levels use four distinct bands", () => {
  assert.equal(scoreToLevel(100), "High");
  assert.equal(scoreToLevel(55), "High");
  assert.equal(scoreToLevel(54), "Medium");
  assert.equal(scoreToLevel(45), "Medium");
  assert.equal(scoreToLevel(44), "Low");
  assert.equal(scoreToLevel(35), "Low");
  assert.equal(scoreToLevel(34), "VeryLow");
  assert.equal(scoreToLevel(0), "VeryLow");
});

const allCriticalPassed = {
  timeframeAligned: true,
  confirmationCandle: true,
  riskRewardRatio: 2,
  newsStatus: "CLEAR" as const,
};

test("a fully confirmed setup keeps its full additive score", () => {
  const result = applyScoreAdvisories(92, allCriticalPassed);
  assert.equal(result.score, 92);
  assert.deepEqual(result.advisories, []);
});

test("a missing critical factor warns without lowering the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, timeframeAligned: false });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /belum selaras/.test(reason)));
});

test("missing confirmation candle warns without lowering the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, confirmationCandle: false });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /konfirmasi/.test(reason)));
});

test("reward/risk below 0.5 warns but never blocks the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, riskRewardRatio: 0.4 });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /RR di bawah 0\.5/.test(reason)));
});

test("reward/risk below 2 warns but never blocks the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, riskRewardRatio: 1.9 });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /RR di bawah 2/.test(reason)));
});

test("reward/risk at 2 raises no warning", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, riskRewardRatio: 2 });
  assert.deepEqual(result.advisories, []);
});

test("high-risk news warns but never blocks the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, newsStatus: "HIGH_RISK" });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /berita tinggi/.test(reason)));
});

test("unavailable news warns but never blocks the score", () => {
  const result = applyScoreAdvisories(95, { ...allCriticalPassed, newsStatus: "UNAVAILABLE" });
  assert.equal(result.score, 95);
  assert.ok(result.advisories.some((reason) => /tidak tersedia/.test(reason)));
});

test("stacked critical gaps all report, and the score still never moves", () => {
  const result = applyScoreAdvisories(87, {
    timeframeAligned: false,
    confirmationCandle: false,
    riskRewardRatio: 0.4,
    newsStatus: "HIGH_RISK",
  });
  assert.equal(result.score, 87);
  assert.equal(result.advisories.length, 4);
});

test("the score stays inside 0-100 no matter the inputs", () => {
  assert.equal(applyScoreAdvisories(140, allCriticalPassed).score, 100);
  assert.equal(applyScoreAdvisories(-20, allCriticalPassed).score, 0);
});

// ─── Partial credit ──────────────────────────────────────────────────────────

import type { Candle } from "./TwelveDataService.js";
import type { TrendData } from "./MarketStructureService.js";
import { calculateConfidence, SCORE_CUTOFFS } from "./EntryConfidenceService.js";

function makeCandles(count: number, lastClose = 100): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = index === count - 1 ? lastClose : 100;
    return {
      datetime: `2026-01-01 ${String(index % 24).padStart(2, "0")}:00:00`,
      open: close,
      high: Math.max(close, 100) + 1,
      low: Math.min(close, 100) - 1,
      close,
      volume: 0,
    };
  });
}

function makeTrend(overrides: Partial<TrendData> = {}): TrendData {
  return {
    direction: "BUY",
    structure: "HH-HL",
    explanation: "test",
    strength: "strong",
    marketState: "TRENDING",
    rsi: 55,
    adx: 30,
    diPlus: 28,
    diMinus: 12,
    adxSlope: 1,
    emaFast: 100,
    emaSlow: 99.5,
    currentPrice: 100,
    candleTime: "2026-01-01 00:00:00",
    ...overrides,
  };
}

test("the displayed score is exactly the sum of the item points", () => {
  const result = calculateConfidence(
    "EURUSD",
    makeTrend(),
    makeTrend(),
    makeCandles(80),
    3,
    { status: "CLEAR", riskScore: 0, headline: "", source: "test", fetchedAt: "", windowMinutes: 0, items: [], upcomingEvents: [] },
  );
  const summed = result.checklist.reduce((total, item) => total + item.points, 0);
  assert.equal(result.score, summed);
  assert.ok(result.score <= 100);
});

test("news keeps zero points but still reports its state", () => {
  const result = calculateConfidence(
    "EURUSD",
    makeTrend(),
    makeTrend(),
    makeCandles(80),
    3,
    { status: "HIGH_RISK", riskScore: 90, headline: "CPI", source: "test", fetchedAt: "", windowMinutes: 0, items: [], upcomingEvents: [] },
  );
  const newsItem = result.checklist.find((item) => item.label === "Risiko Berita Rendah");
  assert.ok(newsItem);
  assert.equal(newsItem.weight, 0);
  assert.equal(newsItem.points, 0);
  assert.ok(result.advisories.some((text) => /berita tinggi/.test(text)));
});

test("a partially aligned setup earns partial credit instead of all or nothing", () => {
  const result = calculateConfidence(
    "EURUSD",
    makeTrend(),
    makeTrend({ marketState: "TRANSITION" }),
    makeCandles(80),
    3,
    { status: "CLEAR", riskScore: 0, headline: "", source: "test", fetchedAt: "", windowMinutes: 0, items: [], upcomingEvents: [] },
  );
  const alignment = result.checklist.find((item) => item.label === "Alignment H1/M15");
  assert.ok(alignment);
  assert.ok(alignment.credit > 0 && alignment.credit < 1, `credit ${alignment.credit}`);
  assert.ok(alignment.points > 0 && alignment.points < Math.round(alignment.weight * 100));
});

test("a late, extended entry loses freshness points without being blocked", () => {
  // Price has run far above the EMA, so the entry is stale by both the
  // distance and the RSI definition of freshness.
  const extended = calculateConfidence(
    "EURUSD",
    makeTrend(),
    makeTrend({ rsi: 82 }),
    makeCandles(80, 110),
    3,
    { status: "CLEAR", riskScore: 0, headline: "", source: "test", fetchedAt: "", windowMinutes: 0, items: [], upcomingEvents: [] },
  );
  const fresh = calculateConfidence(
    "EURUSD",
    makeTrend(),
    makeTrend({ rsi: 55 }),
    makeCandles(80, 100),
    3,
    { status: "CLEAR", riskScore: 0, headline: "", source: "test", fetchedAt: "", windowMinutes: 0, items: [], upcomingEvents: [] },
  );
  const extendedItem = extended.checklist.find((item) => item.label === "Kesegaran Entry");
  const freshItem = fresh.checklist.find((item) => item.label === "Kesegaran Entry");
  assert.ok(extendedItem && freshItem);
  assert.ok(extendedItem.credit < freshItem.credit);
  assert.ok(extended.score < fresh.score);
  // Still a full plan; nothing is blocked.
  assert.equal(extended.tradeAllowed, true);
});

test("the exported cutoffs are the ones the level function uses", () => {
  const [low, medium, high] = SCORE_CUTOFFS;
  assert.equal(scoreToLevel(high), "High");
  assert.equal(scoreToLevel(high - 1), "Medium");
  assert.equal(scoreToLevel(medium), "Medium");
  assert.equal(scoreToLevel(medium - 1), "Low");
  assert.equal(scoreToLevel(low), "Low");
  assert.equal(scoreToLevel(low - 1), "VeryLow");
});
