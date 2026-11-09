import { motion } from 'framer-motion';
import { CheckCircle, XCircle } from 'lucide-react';
import type { ChecklistItem } from '@workspace/api-client-react';

interface ConfidenceCardProps {
  confidence: number;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  checklist: ChecklistItem[];
  index: number;
}

export function ConfidenceCard({ confidence, confidenceLevel, checklist, index }: ConfidenceCardProps) {
  const getConfidenceColor = () => {
    if (confidence >= 71) return 'text-primary';
    if (confidence >= 41) return 'text-amber-400';
    return 'text-destructive';
  };

  const getBgColor = () => {
    if (confidence >= 71) return 'bg-primary/5';
    if (confidence >= 41) return 'bg-amber-500/5';
    return 'bg-destructive/5';
  };

  const getBorderColor = () => {
    if (confidence >= 71) return 'border-primary/20';
    if (confidence >= 41) return 'border-amber-500/20';
    return 'border-destructive/20';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`dashboard-panel min-w-0 border-t-2 ${getBorderColor()} p-4 sm:p-5 xl:col-span-2`}
      data-testid="card-confidence"
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">Skor konfluensi</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Skor heuristik, bukan probabilitas menang.</p>
        
        <div className="mt-4 grid gap-5 xl:grid-cols-[150px_minmax(0,1fr)] xl:items-center">
          <div className="flex flex-col items-center">
          <div className="relative my-3 h-36 w-36">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 160 160" aria-hidden="true">
              <circle
                cx="80"
                cy="80"
                r="70"
                stroke="currentColor"
                strokeWidth="9"
                fill="none"
                className="text-muted/60"
              />
              <motion.circle
                cx="80"
                cy="80"
                r="70"
                stroke="currentColor"
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 70}`}
                className={getConfidenceColor()}
                initial={{ strokeDashoffset: 2 * Math.PI * 70 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 70 * (1 - confidence / 100) }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-mono text-3xl font-semibold tabular-nums ${getConfidenceColor()}`} data-testid="text-confidence-percent">
                {confidence}
              </span>
              <span className="text-[11px] text-muted-foreground">dari 100</span>
            </div>
          </div>
          <div className={`rounded-full border px-3 py-1 ${getBgColor()} ${getBorderColor()}`}>
            <span className={`text-sm font-semibold ${getConfidenceColor()}`} data-testid="text-confidence-level">
              Konfluensi {confidenceLevel === 'High' ? 'tinggi' : confidenceLevel === 'Medium' ? 'sedang' : 'rendah'}
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Faktor analisis</p>
          <div className="grid gap-2 xl:grid-cols-2">
          {checklist.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.5 + idx * 0.1 }}
              className="flex items-center gap-2.5 rounded-lg border border-card-border bg-background/50 px-3 py-2.5"
              data-testid={`checklist-item-${idx}`}
            >
              {item.passed ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-primary" data-testid={`icon-check-${idx}`} />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-destructive" data-testid={`icon-x-${idx}`} />
              )}
              <div className="flex-1">
                <p className={`text-xs font-medium ${item.passed ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </p>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {Math.round(item.weight * 100)}%
              </span>
            </motion.div>
          ))}
          </div>
        </div>
        </div>
      </div>
    </motion.div>
  );
}
