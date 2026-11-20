import { ArrowDownRight, ArrowRight, ArrowUpRight, Newspaper } from 'lucide-react';
import type { MarketAnalysis } from '@workspace/api-client-react';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { scoreTone } from '@/components/ScoreRing';
import { useNow } from '@/hooks/use-now';
import { candleFreshness, formatPrice, formatWib, priceDecimals } from '@/lib/format';

interface OverviewBarProps {
  analysis: MarketAnalysis;
  pair: string;
}

const NEWS_COPY = {
  CLEAR: { label: 'Aman', className: 'text-primary', dot: 'bg-primary' },
  CAUTION: { label: 'Waspada', className: 'text-amber-500', dot: 'bg-amber-500' },
  HIGH_RISK: { label: 'Risiko tinggi', className: 'text-destructive', dot: 'bg-destructive' },
  UNAVAILABLE: { label: 'Tidak tersedia', className: 'text-amber-500', dot: 'bg-amber-500' },
} as const;

const FRESHNESS_COPY = {
  fresh: { dot: 'bg-primary', className: 'text-primary border-primary/25 bg-primary/10' },
  stale: { dot: 'bg-amber-500', className: 'text-amber-500 border-amber-500/25 bg-amber-500/10' },
  closed: { dot: 'bg-muted-foreground', className: 'text-muted-foreground border-border bg-muted/40' },
} as const;

function BiasChip({ direction }: { direction: 'BUY' | 'SELL' }) {
  const isBuy = direction === 'BUY';
  const Icon = isBuy ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm font-bold ${
        isBuy ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/30 bg-destructive/10 text-destructive'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {direction}
    </span>
  );
}

export function OverviewBar({ analysis, pair }: OverviewBarProps) {
  const now = useNow();
  const tone = scoreTone(analysis.confidenceLevel);
  const news = NEWS_COPY[analysis.newsRisk.status] ?? NEWS_COPY.UNAVAILABLE;
  const price = analysis.trendM15?.currentPrice ?? analysis.tradeSetup.currentPrice;
  const freshness = candleFreshness(analysis.trendM15.candleTime, now);
  const freshnessTone = FRESHNESS_COPY[freshness.state];

  return (
    <section
      className="panel overflow-hidden"
      aria-label="Ringkasan pasar"
      data-testid="section-overview"
    >
      <div className="grid grid-cols-2 gap-px bg-border/40 lg:grid-cols-4">
        <div className="bg-card/90 p-4">
          <p className="metric-label">Harga · {pair}</p>
          <p className="num mt-2 text-2xl font-bold leading-none text-foreground">
            <AnimatedNumber value={price} decimals={priceDecimals(pair)} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Candle M15 · {formatWib(analysis.trendM15.candleTime)} WIB
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${freshnessTone.className}`}
              title={`Candle terakhir selesai sekitar ${formatWib(freshness.closedAt)} WIB`}
              data-testid="text-candle-freshness"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${freshnessTone.dot}`} aria-hidden="true" />
              {freshness.label}
            </span>
          </div>
        </div>

        <div className="bg-card/90 p-4">
          <p className="metric-label">Bias</p>
          <div className="mt-2 flex items-center gap-2">
            <BiasChip direction={analysis.summary.bias} />
            <span className={`text-xs font-semibold ${tone.text}`}>{analysis.confidenceLevel}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${tone.bar}`}
                style={{ width: `${Math.min(100, Math.max(0, analysis.confidence))}%` }}
              />
            </div>
            <span className="num text-[11px] text-muted-foreground">
              <AnimatedNumber value={analysis.confidence} />/100
            </span>
          </div>
        </div>

        <div className="bg-card/90 p-4">
          <p className="metric-label">Tren H1 · M15</p>
          <div className="mt-2 flex items-center gap-1.5">
            <BiasChip direction={analysis.trendH1.direction} />
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <BiasChip direction={analysis.trendM15.direction} />
          </div>
          <p className={`mt-3 text-[11px] font-medium ${analysis.timeframeAligned ? 'text-primary' : 'text-amber-500'}`}>
            {analysis.timeframeAligned ? 'H1 & M15 tren searah' : 'H1 & M15 belum tren searah'}
          </p>
        </div>

        <div className="bg-card/90 p-4">
          <p className="metric-label flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
            Risiko berita
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${news.className}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${news.dot}`} aria-hidden="true" />
              {news.label}
            </span>
            <span className="num text-xs text-muted-foreground">{analysis.newsRisk.riskScore}/100</span>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Headline {analysis.newsRisk.windowMinutes} menit terakhir
          </p>
        </div>
      </div>
    </section>
  );
}
