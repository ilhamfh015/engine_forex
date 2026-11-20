import { useEffect, useState } from 'react';
import { BarChart2, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { PairSummary } from '@workspace/api-client-react';

interface HeaderProps {
  selectedPair: string;
  onPairChange: (pair: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdate: string | null;
  dataUpdatedAt?: number;
  pairSummaries?: PairSummary[];
}

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD'];

const AUTO_REFRESH_MS = 60_000;

const EDGE_FADE_LEFT = {
  backgroundImage: 'linear-gradient(to right, hsl(var(--background)), hsl(var(--background) / 0.85), transparent)',
} as const;

const EDGE_FADE_RIGHT = {
  backgroundImage: 'linear-gradient(to left, hsl(var(--background)), hsl(var(--background) / 0.85), transparent)',
} as const;

function formatClock(isoString: string | null) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function Header({
  selectedPair,
  onPairChange,
  onRefresh,
  isRefreshing,
  lastUpdate,
  dataUpdatedAt,
  pairSummaries,
}: HeaderProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = dataUpdatedAt ? Math.max(0, now - dataUpdatedAt) : 0;
  const secondsLeft = Math.max(0, Math.ceil((AUTO_REFRESH_MS - elapsed) / 1000));
  const progress = Math.min(100, Math.max(0, (elapsed / AUTO_REFRESH_MS) * 100));

  const biasByPair = new Map(pairSummaries?.map((summary) => [summary.pair, summary.bias]) ?? []);

  return (
    <header
      className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl print:hidden"
      data-testid="header"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <BarChart2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground" data-testid="text-title">
                Forex Market Structure
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">Analisa struktur pasar multi-timeframe</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Analisa dibuat</p>
              <p className="num text-xs font-medium text-foreground" data-testid="text-last-update">
                {formatClock(lastUpdate)}
                <span className="ml-1.5 text-muted-foreground">
                  · {isRefreshing ? 'memuat' : `${secondsLeft}s`}
                </span>
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => window.print()}
              aria-label="Cetak atau simpan analisa sebagai PDF"
              title="Cetak / simpan PDF"
              className="hidden h-9 w-9 shrink-0 border-border/80 bg-card/60 sm:inline-flex print:hidden"
              data-testid="button-print"
            >
              <Printer className="h-4 w-4" />
            </Button>

            <ThemeToggle />

            <Button
              onClick={onRefresh}
              disabled={isRefreshing}
              size="sm"
              variant="outline"
              className="h-9 gap-2 border-border/80 bg-card/60 print:hidden"
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Perbarui</span>
            </Button>
          </div>
        </div>

        <div className="relative -mx-4 sm:mx-0">
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 sm:hidden"
            style={EDGE_FADE_LEFT}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 sm:hidden"
            style={EDGE_FADE_RIGHT}
            aria-hidden="true"
          />

          <div
            className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2 sm:px-0"
            role="tablist"
            aria-label="Pilih pair"
            data-testid="select-pair"
          >
            {PAIRS.map((pair) => {
              const active = pair === selectedPair;
              const bias = biasByPair.get(pair);
              const dot = bias === 'BUY' ? 'bg-primary' : bias === 'SELL' ? 'bg-destructive' : 'bg-muted-foreground/50';

              return (
                <button
                  key={pair}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onPairChange(pair)}
                  data-testid={`option-pair-${pair}`}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-border bg-card text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
                  {pair}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-0.5 w-full bg-border/30" aria-hidden="true">
        <div
          className="h-full bg-primary/60 transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  );
}
