import { motion } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ChecklistItem, MarketAnalysisConfidenceLevel } from '@workspace/api-client-react';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { ScoreRing, scoreTone } from '@/components/ScoreRing';

interface ConfidenceCardProps {
  confidence: number;
  confidenceLevel: MarketAnalysisConfidenceLevel;
  checklist: ChecklistItem[];
  index: number;
}

export function ConfidenceCard({ confidence, confidenceLevel, checklist, index }: ConfidenceCardProps) {
  const tone = scoreTone(confidenceLevel);
  const passed = checklist.filter((item) => item.passed).length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="panel panel-pad"
      aria-label="Skor konfluensi entry"
      data-testid="card-confidence"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">Skor konfluensi</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Kualitas setup entry</h2>
        </div>
        <span className={`pill ${tone.soft} ${tone.border} ${tone.text}`} data-testid="text-confidence-level">
          {confidenceLevel}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <ScoreRing value={confidence} level={confidenceLevel} size={124}>
          <span className={`num text-3xl font-bold leading-none ${tone.text}`} data-testid="text-confidence-percent">
            <AnimatedNumber value={confidence} />
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            / 100
          </span>
        </ScoreRing>

        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Skor heuristik dari {checklist.length} kondisi. Bukan probabilitas menang.
          </p>

          <div className="mt-3">
            <div className="relative">
              <div className="flex h-1.5 overflow-hidden rounded-full">
                <div className="w-[41%] bg-destructive/40" />
                <div className="w-[30%] bg-amber-500/40" />
                <div className="w-[29%] bg-primary/40" />
              </div>
              <span
                className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground"
                style={{ left: `${Math.min(100, Math.max(0, confidence))}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
            </div>
          </div>

          <p className="mt-3 text-xs text-foreground">
            <span className="font-semibold">{passed}</span>
            <span className="text-muted-foreground"> dari {checklist.length} kondisi terpenuhi</span>
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
        {checklist.map((item, idx) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.15 + idx * 0.04 }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
              item.passed ? 'border-border/60 bg-background/40' : 'border-border/40 bg-background/20'
            }`}
            data-testid={`checklist-item-${idx}`}
          >
            {item.passed ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" data-testid={`icon-check-${idx}`} />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" data-testid={`icon-x-${idx}`} />
            )}

            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] ${item.passed ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {item.label}
              </p>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${item.passed ? 'bg-primary/70' : 'bg-muted-foreground/30'}`}
                  style={{ width: `${Math.round(item.weight * 100)}%` }}
                />
              </div>
            </div>

            <span className="num shrink-0 text-[11px] text-muted-foreground">{Math.round(item.weight * 100)}%</span>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
