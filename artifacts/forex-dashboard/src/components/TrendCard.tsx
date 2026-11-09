import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { TrendData } from '@workspace/api-client-react';

interface TrendCardProps {
  timeframe: 'H1' | 'M15';
  trend: TrendData;
  index: number;
}

export function TrendCard({ timeframe, trend, index }: TrendCardProps) {
  const isBuy = trend.direction === 'BUY';
  const bgColor = isBuy ? 'bg-primary/10' : 'bg-destructive/10';
  const borderColor = isBuy ? 'border-primary/20' : 'border-destructive/20';
  const textColor = isBuy ? 'text-primary' : 'text-destructive';
  const stateColor = trend.marketState === 'TRENDING'
    ? textColor
    : trend.marketState === 'TRANSITION'
      ? 'text-amber-400'
      : 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`dashboard-panel min-w-0 overflow-hidden border-l-2 ${borderColor} p-4 sm:p-5`}
      data-testid={`card-trend-${timeframe}`}
    >
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tren {timeframe}</p>
            <div className="flex items-center gap-2">
              {isBuy ? (
                <TrendingUp className={`h-6 w-6 ${textColor}`} />
              ) : (
                <TrendingDown className={`h-6 w-6 ${textColor}`} />
              )}
              <span className={`text-2xl font-semibold tracking-tight ${textColor}`} data-testid={`text-direction-${timeframe}`}>
                {trend.direction}
              </span>
            </div>
          </div>
          <div className={`rounded-lg border px-2.5 py-1.5 ${borderColor} ${bgColor}`}>
            <span className={`font-mono text-xs font-semibold ${textColor}`} data-testid={`text-structure-${timeframe}`}>
              {trend.structure}
            </span>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded-full border px-2 py-1 font-medium ${borderColor} ${stateColor}`}>
            {trend.marketState === 'TRENDING' ? 'Tren aktif' : trend.marketState === 'TRANSITION' ? 'Transisi' : 'Konsolidasi'}
          </span>
          <span className="rounded-full border border-card-border px-2 py-1 text-muted-foreground">
            {trend.strength === 'strong' ? 'Kuat' : trend.strength === 'moderate' ? 'Sedang' : trend.strength}
          </span>
        </div>
        <div className="mb-4 grid grid-cols-4 gap-2">
          {[
            ['RSI', trend.rsi],
            ['ADX', trend.adx],
            ['DI+', trend.diPlus],
            ['DI−', trend.diMinus],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-background/70 px-2 py-2">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="mt-0.5 truncate font-mono text-xs font-medium tabular-nums text-foreground">
                {Number(value).toFixed(1)}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid={`text-explanation-${timeframe}`}>
          {trend.explanation}
        </p>
      </div>
    </motion.div>
  );
}
