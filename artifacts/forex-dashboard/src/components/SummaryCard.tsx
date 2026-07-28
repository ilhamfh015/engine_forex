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
      className={`relative overflow-hidden rounded-xl border ${borderColor} ${bgColor} backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg`}
      data-testid="card-summary"
    >
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Market Summary</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Trading Bias</span>
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
            <span className="text-sm text-muted-foreground">Confidence</span>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground" data-testid="text-summary-confidence">
                {summary.confidence}%
              </span>
              <span className={`text-sm px-2 py-1 rounded ${bgColor} ${textColor}`} data-testid="text-summary-level">
                {summary.confidenceLevel}
              </span>
            </div>
          </div>

          <div className="pt-4 border-t border-card-border">
            <p className="text-sm font-medium text-muted-foreground mb-2">Analysis</p>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line" data-testid="text-reason">
              {summary.reason}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
