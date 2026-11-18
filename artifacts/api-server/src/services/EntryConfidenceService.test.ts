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

test("weight sits with the factors that were positive in both splits", () => {
  assert.ok(SCORING_WEIGHTS.valueZone > SCORING_WEIGHTS.dmi);
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
