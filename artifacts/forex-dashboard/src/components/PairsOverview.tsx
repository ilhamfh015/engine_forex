import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { PairSummary } from '@workspace/api-client-react';

interface PairsOverviewProps {
  pairs: PairSummary[];
  selectedPair: string;
  onPairSelect: (pair: string) => void;
}

export function PairsOverview({ pairs, selectedPair, onPairSelect }: PairsOverviewProps) {
  return (
    <div className="space-y-4" data-testid="section-pairs-overview">
      <h4 className="text-sm font-medium text-muted-foreground">Ringkasan sinyal per instrumen</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {pairs.map((pair, index) => {
          const isSelected = pair.pair === selectedPair;
          const isBuy = pair.bias === 'BUY';
          const bgColor = isBuy ? 'bg-primary/10' : 'bg-destructive/10';
          const borderColor = isBuy ? 'border-primary/30' : 'border-destructive/30';
          const textColor = isBuy ? 'text-primary' : 'text-destructive';

          return (
            <motion.button
              key={pair.pair}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              onClick={() => onPairSelect(pair.pair)}
              className={`relative rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4 ${
                isSelected
                  ? `${borderColor} ${bgColor} ring-2 ring-offset-2 ring-offset-background ${isBuy ? 'ring-primary' : 'ring-destructive'}`
                  : 'border-card-border bg-card/50 hover:bg-card'
              }`}
              aria-pressed={isSelected}
              data-testid={`button-pair-${pair.pair}`}
            >
              <div className="text-left space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-foreground">{pair.pair}</span>
                  {isBuy ? (
                    <TrendingUp className={`h-4 w-4 ${textColor}`} />
                  ) : (
                    <TrendingDown className={`h-4 w-4 ${textColor}`} />
                  )}
                </div>
                <div className={`text-base font-semibold ${textColor}`} data-testid={`text-pair-bias-${pair.pair}`}>
                  {pair.bias}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{pair.confidence}/100</span>
                  <span className={`px-2 py-0.5 rounded ${bgColor} ${textColor}`}>
                    {pair.confidenceLevel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">H1:</span>
                  <span className={pair.trendH1 === 'BUY' ? 'text-primary' : 'text-destructive'}>
                    {pair.trendH1}
                  </span>
                  <span className="text-muted-foreground">M15:</span>
                  <span className={pair.trendM15 === 'BUY' ? 'text-primary' : 'text-destructive'}>
                    {pair.trendM15}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">News risk</span>
                  <span className={
                    pair.newsStatus === 'HIGH_RISK'
                      ? 'font-semibold text-destructive'
                      : pair.newsStatus === 'CAUTION' || pair.newsStatus === 'UNAVAILABLE'
                        ? 'font-semibold text-amber-400'
                        : 'font-semibold text-primary'
                  }>
                    {pair.newsStatus === 'HIGH_RISK' ? 'HIGH RISK' : pair.newsStatus}
                  </span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
