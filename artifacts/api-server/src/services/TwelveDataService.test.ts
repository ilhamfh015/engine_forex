import assert from "node:assert/strict";
import test from "node:test";
import { parseTwelveDataCandles } from "./TwelveDataService.js";

const validValues = [
  { datetime: "2026-11-09 10:15:00", open: "1.1010", high: "1.1020", low: "1.1000", close: "1.1015" },
  { datetime: "2026-11-09 10:00:00", open: "1.1000", high: "1.1010", low: "1.0990", close: "1.1005" },
];

test("normalizes provider candles into oldest-to-newest order", () => {
  const candles = parseTwelveDataCandles(validValues);

  assert.deepEqual(candles.map((candle) => candle.datetime), [
    "2026-11-09 10:00:00",
    "2026-11-09 10:15:00",
  ]);
  assert.equal(candles[0].volume, 0);
});

test("rejects non-finite prices and invalid OHLC relationships", () => {
  assert.throws(
    () => parseTwelveDataCandles([{ ...validValues[0], close: "not-a-price" }]),
    /invalid OHLCV values/i,
  );
  assert.throws(
    () => parseTwelveDataCandles([{ ...validValues[0], high: "1.1001" }]),
    /invalid OHLCV values/i,
  );
});

test("rejects invalid timestamps and duplicate or out-of-order candles", () => {
  assert.throws(
    () => parseTwelveDataCandles([{ ...validValues[0], datetime: "not-a-time" }]),
    /invalid candle timestamp/i,
  );
  assert.throws(
    () => parseTwelveDataCandles([validValues[0], validValues[0]]),
    /not in chronological order/i,
  );
});
