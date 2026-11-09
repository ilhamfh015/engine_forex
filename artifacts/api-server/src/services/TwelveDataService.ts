/**
 * TwelveDataService
 *
 * Fetches OHLCV candle data from the Twelve Data REST API.
 * Provides shared technical-analysis utilities used by all services.
 *
 * Cache TTLs (free-plan 800 req/day limit):
 *   H1  → 60 min   M15 → 15 min
 *
 * Rate limiter: max 7 req/min (under the 8 req/min free limit).
 * In-flight deduplication: concurrent callers for same key share one fetch.
 */

export interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TwelveDataValue {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

export const PAIR_TO_SYMBOL: Record<string, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAUUSD: "XAU/USD",
  BTCUSD: "BTC/USD",
};

/** Pip size per instrument for risk/reward display */
export const PIP_SIZE: Record<string, number> = {
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDJPY: 0.01,
  XAUUSD: 0.01,
  BTCUSD: 1.0,
};

/** How many decimal places to display prices */
export const PRICE_DECIMALS: Record<string, number> = {
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  XAUUSD: 2,
  BTCUSD: 0,
};

const INTERVAL_MAP: Record<"H1" | "M15", string> = {
  H1: "1h",
  M15: "15min",
};

const CACHE_TTL_MS: Record<"H1" | "M15", number> = {
  H1: 60 * 60 * 1000,
  M15: 15 * 60 * 1000,
};

interface CacheEntry { candles: Candle[]; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Candle[]>>();

// ─── Rate limiter: sliding-window 7 req/min ───────────────────────────────────
const REQUEST_TIMESTAMPS: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 7;
const REQUEST_TIMEOUT_MS = 10_000;

async function waitForRateLimit(): Promise<void> {
  const windowStart = Date.now() - 60_000;
  while (REQUEST_TIMESTAMPS.length > 0 && REQUEST_TIMESTAMPS[0] < windowStart) {
    REQUEST_TIMESTAMPS.shift();
  }
  if (REQUEST_TIMESTAMPS.length >= MAX_REQUESTS_PER_MINUTE) {
    const waitMs = REQUEST_TIMESTAMPS[0] + 60_000 - Date.now() + 200;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    return waitForRateLimit();
  }
  REQUEST_TIMESTAMPS.push(Date.now());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getCandles(
  pair: string,
  timeframe: "H1" | "M15",
  count = 100,
): Promise<Candle[]> {
  const key = `${pair}-${timeframe}-${count}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.candles;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fetchFromApi(pair, timeframe, count, key);
  inFlight.set(key, p);
  try { return await p; } finally { inFlight.delete(key); }
}

async function fetchFromApi(
  pair: string,
  timeframe: "H1" | "M15",
  count: number,
  cacheKey: string,
): Promise<Candle[]> {
  const symbol = PAIR_TO_SYMBOL[pair];
  if (!symbol) throw new Error(`Unsupported pair: ${pair}`);
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is not set");

  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${INTERVAL_MAP[timeframe]}` +
    `&outputsize=${count}` +
    `&apikey=${apiKey}`;

  const request = () => fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  await waitForRateLimit();
  let res = await request();

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 12_000));
    await waitForRateLimit();
    res = await request();
  }
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}: ${res.statusText}`);

  const data = (await res.json()) as {
    status?: string; message?: string;
    values?: TwelveDataValue[];
  };
  if (data.status === "error" || !Array.isArray(data.values) || data.values.length === 0) {
    throw new Error(`Twelve Data error: ${data.message ?? "No data"}`);
  }

  const candles = parseTwelveDataCandles(data.values);

  cache.set(cacheKey, { candles, expiresAt: Date.now() + CACHE_TTL_MS[timeframe] });
  return candles;
}

export function parseTwelveDataCandles(values: TwelveDataValue[]): Candle[] {
  const candles = values.slice().reverse().map((value, index): Candle => {
    const candle: Candle = {
      datetime: typeof value.datetime === "string" ? value.datetime.trim() : "",
      open: Number(value.open),
      high: Number(value.high),
      low: Number(value.low),
      close: Number(value.close),
      volume: Number(value.volume ?? "0"),
    };
    const prices = [candle.open, candle.high, candle.low, candle.close];

    if (!candle.datetime || !Number.isFinite(Date.parse(candle.datetime))) {
      throw new Error(`Twelve Data returned an invalid candle timestamp at index ${index}`);
    }
    if (
      prices.some((price) => !Number.isFinite(price) || price <= 0) ||
      !Number.isFinite(candle.volume) ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close, candle.high)
    ) {
      throw new Error(`Twelve Data returned invalid OHLCV values at index ${index}`);
    }
    return candle;
  });

  for (let index = 1; index < candles.length; index++) {
    if (Date.parse(candles[index].datetime) <= Date.parse(candles[index - 1].datetime)) {
      throw new Error("Twelve Data returned candles that are not in chronological order");
    }
  }

  return candles;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

/** EMA over closing prices. Returns array length == candles.length, oldest→newest. */
export function calcEMA(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(candles.length);
  result[0] = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Wilder's RSI (period 14 default).
 * Returns the last RSI value, using all available candles for a stable seed.
 */
export function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;

  // Seed Wilder's smoothed averages from the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/** Average True Range (Wilder's, period 14 default). */
export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trueRanges.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }
  const seedLength = Math.min(period, trueRanges.length);
  let atr = trueRanges.slice(0, seedLength).reduce((sum, value) => sum + value, 0) / seedLength;
  for (let i = seedLength; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

export interface DMIResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  adxSlope: number;
}

/**
 * Wilder's DMI/ADX.
 *
 * ADX measures trend strength; +DI/-DI provide directional pressure.
 * `adxSlope` compares the current ADX with its recent value so a weakening
 * trend can be marked as a transition instead of a fresh trend.
 */
export function calcDMI(candles: Candle[], period = 14): DMIResult {
  if (candles.length < period * 2 + 1) {
    return { adx: 0, plusDI: 0, minusDI: 0, adxSlope: 0 };
  }

  const trs: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }

  let trSmoothed = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plusSmoothed = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusSmoothed = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  const dx: number[] = [];
  const diValues: Array<{ plusDI: number; minusDI: number }> = [];

  for (let i = period; i < trs.length; i++) {
    trSmoothed = trSmoothed - trSmoothed / period + trs[i];
    plusSmoothed = plusSmoothed - plusSmoothed / period + plusDM[i];
    minusSmoothed = minusSmoothed - minusSmoothed / period + minusDM[i];
    const plusDI = trSmoothed === 0 ? 0 : (100 * plusSmoothed) / trSmoothed;
    const minusDI = trSmoothed === 0 ? 0 : (100 * minusSmoothed) / trSmoothed;
    const denominator = plusDI + minusDI;
    dx.push(denominator === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / denominator);
    diValues.push({ plusDI, minusDI });
  }

  if (dx.length === 0 || diValues.length === 0) {
    return { adx: 0, plusDI: 0, minusDI: 0, adxSlope: 0 };
  }
  const seedLength = Math.min(period, dx.length);
  let adx = dx.slice(0, seedLength).reduce((a, b) => a + b, 0) / seedLength;
  const adxSeries = [adx];
  for (let i = seedLength; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    adxSeries.push(adx);
  }
  const slopeIndex = Math.max(0, adxSeries.length - 5);
  return {
    adx: parseFloat(adx.toFixed(2)),
    plusDI: parseFloat(diValues.at(-1)!.plusDI.toFixed(2)),
    minusDI: parseFloat(diValues.at(-1)!.minusDI.toFixed(2)),
    adxSlope: parseFloat((adx - adxSeries[slopeIndex]).toFixed(2)),
  };
}

/** ADX-only compatibility helper for callers that do not need DMI details. */
export function calcADX(candles: Candle[], period = 14): number {
  return calcDMI(candles, period).adx;
}

/** The newest Twelve Data candle can still be forming; exclude it for signals. */
export function getClosedCandles(candles: Candle[]): Candle[] {
  return candles.length > 1 ? candles.slice(0, -1) : candles;
}

export interface SwingPoint {
  index: number;
  price: number;
}

/**
 * Pivot swing highs with minimum-size filter.
 * A pivot is valid only if its high exceeds all neighbors within `lookback`
 * AND the swing height >= minSizeMult * ATR (removes micro noise).
 */
export function findSwingHighPoints(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): SwingPoint[] {
  const highs: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    // Size filter: swing must be at least minSizeMult * ATR above its lowest neighbour
    if (atr > 0) {
      const lowestNeighbour = Math.min(
        ...candles.slice(i - lookback, i + lookback + 1).map((c) => c.high),
      );
      if (candles[i].high - lowestNeighbour < minSizeMult * atr) continue;
    }
    highs.push({ index: i, price: candles[i].high });
  }
  return highs;
}

export function findSwingHighs(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): number[] {
  return findSwingHighPoints(candles, lookback, atr, minSizeMult).map((point) => point.price);
}

/**
 * Pivot swing lows with minimum-size filter.
 */
export function findSwingLowPoints(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): SwingPoint[] {
  const lows: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    if (atr > 0) {
      const highestNeighbour = Math.max(
        ...candles.slice(i - lookback, i + lookback + 1).map((c) => c.low),
      );
      if (highestNeighbour - candles[i].low < minSizeMult * atr) continue;
    }
    lows.push({ index: i, price: candles[i].low });
  }
  return lows;
}

export function findSwingLows(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): number[] {
  return findSwingLowPoints(candles, lookback, atr, minSizeMult).map((point) => point.price);
}
