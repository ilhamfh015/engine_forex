import { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  pair: string;
}

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  XAUUSD: 'TVC:GOLD',
  BTCUSD: 'BINANCE:BTCUSDT'
};

export function TradingViewWidget({ pair }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = SYMBOL_MAP[pair] || 'FX:EURUSD';

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear existing content
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (typeof window.TradingView !== 'undefined' && containerRef.current) {
        new window.TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#0d0f14',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: containerRef.current.id,
          backgroundColor: '#0d0f14',
          gridColor: 'rgba(255, 255, 255, 0.06)',
        });
      }
    };

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [symbol]);

  return (
    <div className="space-y-4" data-testid="section-chart">
      <h3 className="text-lg font-semibold text-foreground">Live Chart</h3>
      <div className="rounded-xl overflow-hidden border border-card-border bg-card/50 backdrop-blur-sm">
        <div
          id={`tradingview_${pair}`}
          ref={containerRef}
          style={{ height: '500px', width: '100%' }}
        />
      </div>
    </div>
  );
}

declare global {
  interface Window {
    TradingView: any;
  }
}
