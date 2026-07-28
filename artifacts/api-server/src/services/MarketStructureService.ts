/**
 * MarketStructureService
 *
 * Analyzes market structure for a given currency pair and timeframe.
 * Returns a BUY or SELL direction based on Higher High / Higher Low
 * or Lower High / Lower Low pattern detection.
 *
 * NOTE: Currently uses a deterministic simulation based on seeded
 * pseudo-random values tied to the pair + time bucket.
 * Replace `getSimulatedOHLC()` with real MT5 / broker API calls
 * to use live data.
 */

export type TrendDirection = "BUY" | "SELL";

export interface TrendData {
  direction: TrendDirection;
  structure: string;
  explanation: string;
}

/** Supported currency pairs */
export const SUPPORTED_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * Deterministically selects a value from an array using a numeric seed.
 * Ensures the same pair + time bucket always returns the same value
 * within a given 15-minute window, changing slowly over time.
 */
function seededIndex(seed: number, length: number): number {
  return Math.abs(seed) % length;
}

/**
 * Generates a stable numeric seed from a pair name and the current
 * time bucket.  The bucket changes every `intervalMinutes` minutes,
 * so the analysis updates periodically without requiring live data.
 */
function getSeed(pair: string, intervalMinutes = 15): number {
  const bucket = Math.floor(Date.now() / (intervalMinutes * 60 * 1000));
  // Simple hash: sum char codes × bucket
  const charSum = pair.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return (charSum * 7 + bucket * 13) % 1000;
}

/**
 * Returns the trend analysis for a specific pair and timeframe.
 *
 * @param pair   - e.g. "EURUSD"
 * @param timeframe - "H1" | "M15"
 */
export function analyzeTrend(pair: string, timeframe: "H1" | "M15"): TrendData {
  // Use different interval buckets for H1 vs M15 to create realistic divergence
  const intervalMinutes = timeframe === "H1" ? 60 : 15;
  const seed = getSeed(pair + timeframe, intervalMinutes);

  const buyStructures = ["HH-HL", "HH-HL", "HH-HL"];
  const sellStructures = ["LH-LL", "LH-LL", "LH-LL"];

  const buyExplanations = [
    "Harga mencetak Higher High dan Higher Low. Struktur bullish terkonfirmasi.",
    "Breakout di atas swing high sebelumnya. Buyer mendominasi momentum.",
    "Higher Low terbentuk di atas level support. Tekanan beli meningkat.",
  ];

  const sellExplanations = [
    "Harga mencetak Lower High dan Lower Low. Struktur bearish terkonfirmasi.",
    "Gagal menembus swing high. Seller mengambil kendali momentum.",
    "Lower High terbentuk di bawah resistance. Tekanan jual mendominasi.",
  ];

  // Slight bias: pairs tend to trend more often than not
  const directionSeed = seededIndex(seed, 10);
  const direction: TrendDirection = directionSeed < 6 ? "BUY" : "SELL";

  if (direction === "BUY") {
    const idx = seededIndex(seed, buyStructures.length);
    return {
      direction: "BUY",
      structure: buyStructures[idx],
      explanation: buyExplanations[idx],
    };
  } else {
    const idx = seededIndex(seed, sellStructures.length);
    return {
      direction: "SELL",
      structure: sellStructures[idx],
      explanation: sellExplanations[idx],
    };
  }
}
