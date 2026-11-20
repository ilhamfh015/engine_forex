const PRICE_DECIMALS: Record<string, number> = {
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  XAUUSD: 2,
  BTCUSD: 0,
};

export function priceDecimals(pair: string): number {
  return PRICE_DECIMALS[pair] ?? 5;
}

export function formatPrice(value: number, pair: string): string {
  return value.toFixed(priceDecimals(pair));
}

export function formatWib(isoString: string, withDate = false): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    ...(withDate ? { day: '2-digit' as const, month: 'short' as const, year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoString));
}

export function formatRelative(isoString: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(isoString)) / 60_000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return 'kurang dari 1 menit';
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
  return `${Math.floor(hours / 24)} hari`;
}

export type FreshnessState = 'fresh' | 'stale' | 'closed';

/**
 * Crypto pairs trade around the clock, so a quiet feed there always means the
 * data is lagging — never that the market is closed.
 */
export type MarketKind = 'forex' | 'crypto';

const CRYPTO_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'BNB', 'LTC'];

export function marketKind(pair: string): MarketKind {
  const symbol = pair.toUpperCase();
  return CRYPTO_BASES.some((base) => symbol.startsWith(base)) ? 'crypto' : 'forex';
}

/** Forex closes Friday 22:00 UTC and reopens Sunday 22:00 UTC. */
export function isForexMarketClosed(nowMs: number): boolean {
  const at = new Date(nowMs);
  const day = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hour = at.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && hour >= 22) return true;
  if (day === 0 && hour < 22) return true;
  return false;
}

export interface CandleFreshness {
  state: FreshnessState;
  market: MarketKind;
  /** Minutes since the candle finished forming. */
  ageMinutes: number;
  /** Approximate close time of the last closed candle. */
  closedAt: string;
  label: string;
}

/**
 * Freshness for a closed M15 candle. The candle timestamp is its open time, so
 * the age is measured from open + 15 minutes.
 *
 * fresh  : age <= 30 min (about two bars) — feed is keeping up
 * stale  : older than that — provider lag (or a quiet session for forex)
 * closed : older than 120 min *and* the forex weekend session is in effect.
 *          Crypto never reaches this state because it trades 24/7.
 */
export function candleFreshness(
  candleTime: string,
  now: number,
  timeframeMinutes = 15,
  market: MarketKind = 'forex',
): CandleFreshness {
  const openMs = Date.parse(candleTime);

  if (!Number.isFinite(openMs)) {
    return {
      state: 'stale',
      market,
      ageMinutes: 0,
      closedAt: candleTime,
      label: 'Waktu candle tidak diketahui',
    };
  }

  const closedMs = openMs + timeframeMinutes * 60_000;
  const ageMinutes = Math.max(0, Math.floor((now - closedMs) / 60_000));
  const state: FreshnessState =
    ageMinutes <= 30
      ? 'fresh'
      : ageMinutes > 120 && market === 'forex' && isForexMarketClosed(now)
        ? 'closed'
        : 'stale';

  const label =
    state === 'fresh'
      ? 'Data segar'
      : state === 'closed'
        ? 'Pasar kemungkinan tutup'
        : `Candle ${formatDuration(ageMinutes)} lalu`;

  return { state, market, ageMinutes, closedAt: new Date(closedMs).toISOString(), label };
}

