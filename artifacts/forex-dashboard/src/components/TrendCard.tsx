import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { TrendData } from '@workspace/api-client-react';
import { formatWib } from '@/lib/format';

interface TrendCardProps {
  timeframe: 'H1' | 'M15';
  trend: TrendData;
  index: number;
}

const STATE_COPY = {
  TRENDING: { label: 'Trending', className: 'text-primary border-primary/25 bg-primary/10' },
  TRANSITION: { label: 'Transisi', className: 'text-amber-500 border-amber-500/25 bg-amber-500/10' },
  RANGING: { label: 'Ranging', className: 'text-muted-foreground border-border bg-muted/40' },
} as const;

export function TrendCard({ timeframe, trend, index }: TrendCardProps) {
  const isBuy = trend.direction === 'BUY';
  const tone = isBuy ? 'text-primary' : 'text-destructive';
  const soft = isBuy ? 'bg-primary/10 border-primary/25' : 'bg-destructive/10 border-destructive/25';
  const state = STATE_COPY[trend.marketState] ?? STATE_COPY.RANGING;
  const Icon = isBuy ? ArrowUpRight : ArrowDownRight;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="panel panel-pad"
      aria-label={`Tren ${timeframe}`}
      data-testid={`card-trend-${timeframe}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Tren {timeframe}</p>
          <div className="mt-2 flex items-center gap-2">
            <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" />
            <span className={`text-2xl font-bold leading-none ${tone}`} data-testid={`text-direction-${timeframe}`}>
              {trend.direction}
            </span>
            <span className="pill border-border text-muted-foreground" data-testid={`text-structure-${timeframe}`}>
              {trend.structure}
            </span>
          </div>
        </div>

        <div className="text-right">
          <span className={`pill ${soft} ${tone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {trend.strength}
          </span>
          <p className={`mt-1.5 text-[11px] font-medium ${state.className.split(' ')[0]}`}>{state.label}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-4">
        <div>
          <dt className="metric-label">RSI 14</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-foreground">{trend.rsi.toFixed(1)}</dd>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${trend.rsi >= 50 ? 'bg-primary/70' : 'bg-destructive/70'}`}
              style={{ width: `${Math.min(100, Math.max(0, trend.rsi))}%` }}
            />
          </div>
        </div>

        <div>
          <dt className="metric-label">ADX 14</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-foreground">{trend.adx.toFixed(1)}</dd>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/40"
              style={{ width: `${Math.min(100, (trend.adx / 50) * 100)}%` }}
            />
          </div>
        </div>

        <div>
          <dt className="metric-label">DI+</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-primary">{trend.diPlus.toFixed(1)}</dd>
        </div>

        <div>
          <dt className="metric-label">DI−</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-destructive">{trend.diMinus.toFixed(1)}</dd>
        </div>
      </dl>

      <p
        className="mt-4 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground"
        title={trend.explanation}
        data-testid={`text-explanation-${timeframe}`}
      >
        <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        <span className="line-clamp-3">{trend.explanation}</span>
      </p>

      <p className="mt-3 text-[11px] text-muted-foreground/80">
        Candle terakhir {formatWib(trend.candleTime)} WIB
        {trend.adxSlope < 0 ? ' · ADX melemah' : ' · ADX menguat'}
      </p>
    </motion.article>
  );
}
