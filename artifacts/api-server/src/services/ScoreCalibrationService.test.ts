import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  cumulativeCutoffTable,
  evaluateScoreBands,
  suggestScoreBands,
  type CalibrationTrade,
} from "./ScoreCalibrationService.js";

function repeated(score: number, netR: number, count: number): CalibrationTrade[] {
  return Array.from({ length: count }, () => ({ score, netR }));
}

test("evaluateScoreBands partitions every trade exactly once", () => {
  const trades: CalibrationTrade[] = [
    ...repeated(10, -1, 4),
    ...repeated(45, -0.2, 4),
    ...repeated(65, 0.1, 4),
    ...repeated(85, 0.5, 4),
  ];

  const bands = evaluateScoreBands(trades, [40, 60, 80]);
  assert.deepEqual(bands.map((band) => band.key), ["0-39", "40-59", "60-79", "80-100"]);
  assert.deepEqual(bands.map((band) => band.trades), [4, 4, 4, 4]);
  assert.equal(bands.reduce((sum, band) => sum + band.trades, 0), trades.length);
  assert.deepEqual(bands.map((band) => band.expectancyNetR), [-1, -0.2, 0.1, 0.5]);
});

test("cumulative cutoff table only keeps trades at or above each cutoff", () => {
  const trades: CalibrationTrade[] = [
    ...repeated(10, -1, 3),
    ...repeated(50, -0.1, 2),
    ...repeated(70, 0.3, 5),
  ];

  const rows = cumulativeCutoffTable(trades, 10);
  assert.equal(rows[0].trades, 10);
  const row50 = rows.find((row) => row.key === ">=50");
  assert.equal(row50?.trades, 7);
  const row60 = rows.find((row) => row.key === ">=60");
  assert.equal(row60?.trades, 5);
  assert.equal(row60?.expectancyNetR, 0.3);
});

test("suggestScoreBands finds ascending cutoffs when expectancy rises with score", () => {
  const trades: CalibrationTrade[] = [
    ...repeated(15, -0.9, 30),
    ...repeated(35, -0.5, 30),
    ...repeated(50, -0.1, 30),
    ...repeated(65, 0.1, 30),
    ...repeated(75, 0.3, 30),
    ...repeated(90, 0.7, 30),
  ];

  const suggestion = suggestScoreBands(trades, { minTrades: 10 });
  const [orange, yellow, green] = suggestion.cutoffs;

  assert.ok(orange < yellow && yellow < green);
  assert.equal(suggestion.bands.reduce((sum, band) => sum + band.trades, 0), trades.length);
  assert.equal(suggestion.reliable, true);
  assert.ok((suggestion.bands[3].expectancyNetR ?? -1) > (suggestion.bands[0].expectancyNetR ?? 1));
});

test("suggestScoreBands reports unreliable bands when every score bin is thin", () => {
  const trades: CalibrationTrade[] = [
    { score: 20, netR: -0.5 },
    { score: 55, netR: 0.1 },
    { score: 85, netR: 0.4 },
  ];

  const suggestion = suggestScoreBands(trades, { minTrades: 10 });
  assert.equal(suggestion.reliable, false);
  assert.ok(suggestion.warnings.length > 0);
  assert.equal(suggestion.bands.reduce((sum, band) => sum + band.trades, 0), trades.length);
});

test("suggestScoreBands handles an empty sample without throwing", () => {
  const suggestion = suggestScoreBands([]);
  assert.equal(suggestion.reliable, false);
  assert.deepEqual(suggestion.cutoffs, [35, 45, 55]);
  assert.ok(suggestion.warnings.some((warning) => /No filled trades/.test(warning)));
});
