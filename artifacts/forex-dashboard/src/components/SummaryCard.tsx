import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import type { MarketSummary } from '@workspace/api-client-react';

interface SummaryCardProps {
  summary: MarketSummary;
  note: string;
  index: number;
}

export function SummaryCard({ summary, note, index }: SummaryCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="panel panel-pad"
      aria-label="Penjelasan analisa"
      data-testid="card-summary"
    >
      <p className="eyebrow">Penjelasan engine</p>
      <h2 className="mt-1 text-base font-semibold text-foreground">Kenapa bias ini?</h2>

      <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90" data-testid="text-reason">
        {summary.reason}
      </p>

      {note ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>
        </div>
      ) : null}
    </motion.section>
  );
}
