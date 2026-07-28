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
  const borderColor = isBuy ? 'border-primary/30' : 'border-destructive/30';
  const textColor = isBuy ? 'text-primary' : 'text-destructive';
  const glowClass = isBuy ? 'pulse-glow-green' : 'pulse-glow-red';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`relative overflow-hidden rounded-xl border ${borderColor} ${bgColor} backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg ${glowClass}`}
      data-testid={`card-trend-${timeframe}`}
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">Trend {timeframe}</p>
            <div className="flex items-center gap-2">
              {isBuy ? (
                <TrendingUp className={`h-6 w-6 ${textColor}`} />
              ) : (
                <TrendingDown className={`h-6 w-6 ${textColor}`} />
              )}
              <span className={`text-3xl font-bold ${textColor}`} data-testid={`text-direction-${timeframe}`}>
                {trend.direction}
              </span>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full ${bgColor} border ${borderColor}`}>
            <span className={`text-sm font-semibold ${textColor}`} data-testid={`text-structure-${timeframe}`}>
              {trend.structure}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-explanation-${timeframe}`}>
          {trend.explanation}
        </p>
      </div>
    </motion.div>
  );
}
