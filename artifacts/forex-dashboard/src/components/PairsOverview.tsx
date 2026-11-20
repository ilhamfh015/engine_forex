import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Check } from 'lucide-react';
import type { PairSummary } from '@workspace/api-client-react';
import { scoreTone } from '@/components/ScoreRing';

interface PairsOverviewProps {
  pairs: PairSummary[];
  selectedPair: string;
  onPairSelect: (pair: string) => void;
}

const NEWS_DOT: Record<PairSummary['newsStatus'], string> = {
  CLEAR: 'bg-primary',
  CAUTION: 'bg-amber-500',
  HIGH_RISK: 'bg-destructive',
  UNAVAILABLE: 'bg-amber-500',
};

export function PairsOverview({ pairs, selectedPair, onPairSelect }: PairsOverviewProps) {
  return (
    <section className="space-y-3" data-testid="section-pairs-overview" aria-label="Ringkasan semua pair">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Pantauan</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Semua pair</h2>
        </div>
        <p className="text-[11px] text-muted-foreground">Klik kartu untuk mengganti pair aktif</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {pairs.map((pair, index) => {
          const selected = pair.pair === selectedPair;
          const isBuy = pair.bias === 'BUY';
          const Icon = isBuy ? ArrowUpRight : ArrowDownRight;
          const tone = scoreTone(pair.confidenceLevel);

          return (
            <motion.button
              key={pair.pair}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: index * 0.04 }}
              onClick={() => onPairSelect(pair.pair)}
              aria-pressed={selected}
              className={`panel group p-3.5 text-left transition-colors hover:border-border ${
                selected ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/25' : ''
              }`}
              data-testid={`button-pair-${pair.pair}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wide text-foreground">{pair.pair}</span>
                {selected ? (
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                ) : (
                  <span className="num text-[11px] text-muted-foreground">{pair.confidence}</span>
                )}
              </div>

              <div className="mt-2 flex items-center gap-1.5">
                <Icon className={`h-4 w-4 ${isBuy ? 'text-primary' : 'text-destructive'}`} aria-hidden="true" />
                <span
                  className={`text-sm font-bold ${isBuy ? 'text-primary' : 'text-destructive'}`}
                  data-testid={`text-pair-bias-${pair.pair}`}
                >
                  {pair.bias}
                </span>
                <span className={`ml-auto pill border-border/60 px-1.5 py-0 text-[10px] ${tone.text}`}>
                  {pair.confidenceLevel}
                </span>
              </div>

              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pair.confidence}%` }} />
              </div>

              <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className={pair.trendH1 === 'BUY' ? 'font-semibold text-primary' : 'font-semibold text-destructive'}>
                    H1 {pair.trendH1}
                  </span>
                  <span className="opacity-40">·</span>
                  <span className={pair.trendM15 === 'BUY' ? 'font-semibold text-primary' : 'font-semibold text-destructive'}>
                    M15 {pair.trendM15}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${NEWS_DOT[pair.newsStatus] ?? 'bg-amber-500'}`} aria-hidden="true" />
                  {pair.newsStatus === 'HIGH_RISK' ? 'HIGH' : pair.newsStatus}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
