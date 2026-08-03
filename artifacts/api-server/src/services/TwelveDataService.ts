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
  count = 50,
): Promise<Candle[]> {
  const key = `${pair}-${timeframe}`;
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

  await waitForRateLimit();
  let res = await fetch(url);

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 12_000));
    await waitForRateLimit();
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}: ${res.statusText}`);

  const data = (await res.json()) as {
    status?: string; message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
  };
  if (data.status === "error" || !data.values || data.values.length === 0) {
    throw new Error(`Twelve Data error: ${data.message ?? "No data"}`);
  }

  const candles: Candle[] = data.values.slice().reverse().map((v) => ({
    datetime: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume ?? "0"),
  }));

  cache.set(cacheKey, { candles, expiresAt: Date.now() + CACHE_TTL_MS[timeframe] });
  return candles;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

/** EMA over closing prices. Returns array length == candles.length, oldest→newest. */
export function calcEMA(candles: Candle[], period: number): number[] {
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
 * Returns value 0-100. Requires at least period+1 candles; returns 50 otherwise.
 */
export function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  const slice = candles.slice(-(period + 1));
  let avgGain = 0;
  let avgLoss = 0;

  // First average (simple)
  for (let i = 1; i <= period; i++) {
    const change = slice[i].close - slice[i - 1].close;
    if (change > 0) avgGain += change / period;
    else avgLoss += -change / period;
  }
  if (avgLoss === 0) return 100;
  let rs = avgGain / avgLoss;

  // Wilder smoothing for remaining bars (if candles > period+1)
  const extra = candles.slice(-(candles.length - (candles.length - period)));
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  }

  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/** Average True Range (Wilder's, period 14 default). */
export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-(period + 1));

  // First TR (simple)
  let atr = slice[1].high - slice[1].low; // approximate first
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close),
    );
    // Wilder smoothing
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

/**
 * Pivot swing highs with minimum-size filter.
 * A pivot is valid only if its high exceeds all neighbors within `lookback`
 * AND the swing height >= minSizeMult * ATR (removes micro noise).
 */
export function findSwingHighs(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): number[] {
  const highs: number[] = [];
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
    highs.push(candles[i].high);
  }
  return highs;
}

/**
 * Pivot swing lows with minimum-size filter.
 */
export function findSwingLows(
  candles: Candle[],
  lookback = 2,
  atr = 0,
  minSizeMult = 0.3,
): number[] {
  const lows: number[] = [];
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
    lows.push(candles[i].low);
  }
  return lows;
}
