/**
 * TradingViewService
 *
 * Provides TradingView widget configuration for each supported pair.
 * Returns the correct TradingView symbol string for the frontend
 * to embed in the TradingView Advanced Chart widget.
 *
 * Symbol mapping follows TradingView's symbol convention:
 *   FX pairs  → FX:EURUSD
 *   Gold      → TVC:GOLD
 *   BTC/USD   → BINANCE:BTCUSDT
 */

export interface TradingViewConfig {
  symbol: string;
  interval: string;
  theme: "dark" | "light";
}

/** Maps internal pair names to TradingView symbol strings */
const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "FX:EURUSD",
  GBPUSD: "FX:GBPUSD",
  USDJPY: "FX:USDJPY",
  XAUUSD: "TVC:GOLD",
  BTCUSD: "BINANCE:BTCUSDT",
};

/**
 * Returns the TradingView widget configuration for a given pair.
 *
 * @param pair - e.g. "EURUSD"
 * @param interval - TradingView interval string, defaults to "60" (H1)
 */
export function getTradingViewConfig(pair: string, interval = "60"): TradingViewConfig {
  const symbol = SYMBOL_MAP[pair.toUpperCase()] ?? `FX:${pair.toUpperCase()}`;
  return {
    symbol,
    interval,
    theme: "dark",
  };
}

/**
 * Returns all available pair-to-symbol mappings.
 * Used by the frontend to build the symbol selector.
 */
export function getSymbolMap(): Record<string, string> {
  return { ...SYMBOL_MAP };
}
