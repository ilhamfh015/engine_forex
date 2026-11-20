import { useEffect, useRef } from 'react';
import { CandlestickChart } from 'lucide-react';
import { useTheme } from '@/lib/theme';

interface TradingViewWidgetProps {
  pair: string;
}

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  XAUUSD: 'TVC:GOLD',
  BTCUSD: 'BINANCE:BTCUSDT',
};

export function TradingViewWidget({ pair }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const symbol = SYMBOL_MAP[pair] || 'FX:EURUSD';
  const containerId = `tradingview_${pair}_${theme}`;

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const dark = theme === 'dark';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (typeof window.TradingView !== 'undefined' && containerRef.current) {
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme: dark ? 'dark' : 'light',
          style: '1',
          locale: 'id',
          toolbar_bg: dark ? '#0d1117' : '#f8fafc',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: containerRef.current.id,
          backgroundColor: dark ? '#0d1117' : '#ffffff',
          gridColor: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
        });
      }
    };

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [symbol, theme]);

  return (
    <section className="space-y-3 print:hidden" data-testid="section-chart" aria-label="Grafik harga">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <CandlestickChart className="h-3.5 w-3.5" aria-hidden="true" />
            Grafik
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Harga {pair}</h2>
        </div>
        <p className="text-[11px] text-muted-foreground">TradingView · interval 1 jam</p>
      </div>

      <div className="panel overflow-hidden">
        <div id={containerId} ref={containerRef} className="h-[380px] w-full sm:h-[460px] lg:h-[520px]" />
      </div>
    </section>
  );
}

declare global {
  interface Window {
    TradingView: any;
  }
}
