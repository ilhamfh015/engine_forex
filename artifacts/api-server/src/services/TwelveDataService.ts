/**
 * TwelveDataService
 *
 * Fetches OHLCV candle data from the Twelve Data REST API.
 * Provides shared utilities: EMA, ATR, swing detection.
 *
 * Cache TTLs (stay within free-plan 800 req/day limit):
 *   H1  → 60 minutes  (new H1 candle every hour)
 *   M15 → 15 minutes  (new M15 candle every 15 min)
 *
 * In-flight deduplication prevents thundering-herd 429s on cold start.
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

const INTERVAL_MAP: Record<"H1" | "M15", string> = {
  H1: "1h",
  M15: "15min",
};

const CACHE_TTL_MS: Record<"H1" | "M15", number> = {
  H1: 60 * 60 * 1000,
  M15: 15 * 60 * 1000,
};

interface CacheEntry {
  candles: Candle[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Candle[]>>();

// ─── Rate limiter (sliding window, max 7 req/min to stay under 8/min limit) ──
const REQUEST_TIMESTAMPS: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 7;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const windowStart = now - 60_000;

  // Drop timestamps outside the 60-second window
  while (REQUEST_TIMESTAMPS.length > 0 && REQUEST_TIMESTAMPS[0] < windowStart) {
    REQUEST_TIMESTAMPS.shift();
  }

  if (REQUEST_TIMESTAMPS.length >= MAX_REQUESTS_PER_MINUTE) {
    // Wait until the oldest request leaves the window
    const waitMs = REQUEST_TIMESTAMPS[0] + 60_000 - Date.now() + 200;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    // Recurse to re-check after waiting
    return waitForRateLimit();
  }

  REQUEST_TIMESTAMPS.push(Date.now());
}

/**
 * Returns OHLCV candles ordered OLDEST → NEWEST.
 * Results cached by TTL; concurrent requests share one HTTP fetch.
 */
export async function getCandles(
  pair: string,
  timeframe: "H1" | "M15",
  count = 50,
): Promise<Candle[]> {
  const cacheKey = `${pair}-${timeframe}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.candles;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const fetchPromise = fetchFromApi(pair, timeframe, count, cacheKey);
  inFlight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(cacheKey);
  }
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

  // Respect rate limit before each outbound request
  await waitForRateLimit();

  let response = await fetch(url);

  // Retry once on 429 — wait for the rate limiter window to clear
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 12_000)); // 12 s cooldown
    await waitForRateLimit();
    response = await fetch(url);
  }

  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    status?: string;
    message?: string;
    values?: Array<{
      datetime: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume?: string;
    }>;
  };

  if (data.status === "error" || !data.values || data.values.length === 0) {
    throw new Error(`Twelve Data error: ${data.message ?? "No candle data returned"}`);
  }

  // Twelve Data: newest-first → reverse to oldest-first
  const candles: Candle[] = data.values
    .slice()
    .reverse()
    .map((v) => ({
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

// ─── Technical Indicators ────────────────────────────────────────────────────

/**
 * Exponential Moving Average over closing prices.
 * Returns an array of the same length as `candles` (oldest → newest).
 */
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
 * Average True Range over the last `period` candles.
 */
export function calcATR(candles: Candle[], period = 14): number {
  const slice = candles.slice(-(period + 1));
  if (slice.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    sum += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close),
    );
  }
  return sum / (slice.length - 1);
}

/**
 * Pivot swing highs: candle[i].high is the highest among `lookback` neighbors.
 * Returns price values oldest → newest.
 */
export function findSwingHighs(candles: Candle[], lookback = 2): number[] {
  const highs: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) highs.push(candles[i].high);
  }
  return highs;
}

/**
 * Pivot swing lows: candle[i].low is the lowest among `lookback` neighbors.
 * Returns price values oldest → newest.
 */
export function findSwingLows(candles: Candle[], lookback = 2): number[] {
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) lows.push(candles[i].low);
  }
  return lows;
}
