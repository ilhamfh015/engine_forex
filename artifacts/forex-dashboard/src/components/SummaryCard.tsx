import { motion } from 'framer-motion';
import { Target, TrendingUp, TrendingDown } from 'lucide-react';
import type { MarketSummary } from '@workspace/api-client-react';

interface SummaryCardProps {
  summary: MarketSummary;
  index: number;
}

export function SummaryCard({ summary, index }: SummaryCardProps) {
  const isBuy = summary.bias === 'BUY';
  const bgColor = isBuy ? 'bg-primary/10' : 'bg-destructive/10';
  const borderColor = isBuy ? 'border-primary/30' : 'border-destructive/30';
  const textColor = isBuy ? 'text-primary' : 'text-destructive';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`dashboard-panel min-w-0 border-t-2 ${borderColor} p-4 sm:p-5`}
      data-testid="card-summary"
    >
      <div>
        <div className="mb-5 flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Ringkasan pasar</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Arah dominan</span>
            <div className="flex items-center gap-2">
              {isBuy ? (
                <TrendingUp className={`h-5 w-5 ${textColor}`} />
              ) : (
                <TrendingDown className={`h-5 w-5 ${textColor}`} />
              )}
              <span className={`text-xl font-bold ${textColor}`} data-testid="text-bias">
                {summary.bias}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Skor konfluensi</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold tabular-nums text-foreground" data-testid="text-summary-confidence">
                {summary.confidence}/100
              </span>
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${bgColor} ${textColor}`} data-testid="text-summary-level">
                {summary.confidenceLevel}
              </span>
            </div>
          </div>

          <div className="pt-4 border-t border-card-border">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Catatan analisis</p>
            <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-line" data-testid="text-reason">
              {summary.reason}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
