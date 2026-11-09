import assert from "node:assert/strict";
import test from "node:test";
import { generateSummary } from "./SummaryService.js";

test("structure confirmation alone does not claim price is in the value zone", () => {
  const summary = generateSummary(
    "EURUSD",
    "BUY",
    "BUY",
    70,
    "Medium",
    [{ label: "Struktur HH-HL/LH-LL", passed: true, weight: 0.15 }],
  );

  assert.match(summary.reason, /belum mencapai zona entry ideal/i);
  assert.doesNotMatch(summary.reason, /retracement mendekati area Higher Low/i);
});
