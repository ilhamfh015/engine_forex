import { motion } from 'framer-motion';
import { CheckCircle, Info, XCircle } from 'lucide-react';
import type { ChecklistItem } from '@workspace/api-client-react';

interface ConfidenceCardProps {
  confidence: number;
  confidenceLevel: 'High' | 'Medium' | 'Low' | 'VeryLow';
  checklist: ChecklistItem[];
  advisories?: string[];
  index: number;
}

function scoreTone(confidence: number) {
  if (confidence >= 55) {
    return {
      text: 'text-primary',
      bg: 'bg-primary/5',
      border: 'border-primary/20',
      label: 'Sangat kuat',
      range: '55–100',
    };
  }
  if (confidence >= 45) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/20',
      label: 'Sedang',
      range: '45–54',
    };
  }
  if (confidence >= 35) {
    return {
      text: 'text-orange-400',
      bg: 'bg-orange-500/5',
      border: 'border-orange-500/20',
      label: 'Waspada',
      range: '35–44',
    };
  }
  return {
    text: 'text-destructive',
    bg: 'bg-destructive/5',
    border: 'border-destructive/20',
    label: 'Lemah',
    range: '0–34',
  };
}

const LEVEL_LABELS: Record<ConfidenceCardProps['confidenceLevel'], string> = {
  High: 'tinggi',
  Medium: 'sedang',
  Low: 'rendah',
  VeryLow: 'sangat rendah',
};

export function ConfidenceCard({ confidence, confidenceLevel, checklist, advisories, index }: ConfidenceCardProps) {
  const tone = scoreTone(confidence);
  const getConfidenceColor = () => tone.text;
  const getBgColor = () => tone.bg;
  const getBorderColor = () => tone.border;

  // The score is never clamped, so advisories are pure context: they explain
  // the gaps without claiming the number was rewritten.
  const advisoryText = advisories && advisories.length > 0 ? `Perhatian: ${advisories.join('; ')}` : '';

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

        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium">
          <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary">55–100 kuat</span>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-400">45–54 sedang</span>
          <span className="rounded-full border border-orange-500/20 bg-orange-500/5 px-2 py-0.5 text-orange-400">35–44 waspada</span>
          <span className="rounded-full border border-destructive/20 bg-destructive/5 px-2 py-0.5 text-destructive">0–34 lemah</span>
        </div>

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
              Konfluensi {LEVEL_LABELS[confidenceLevel]}
            </span>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Band {tone.range}: {tone.label}
          </p>
          {advisoryText && (
            <p
              className="mt-1 max-w-[190px] text-center text-[11px] leading-snug text-amber-400"
              data-testid="text-score-advisories"
            >
              {advisoryText}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Faktor analisis</p>
          <div className="grid gap-2 xl:grid-cols-2">
          {checklist.map((item, idx) => {
            // Factors with weight 0 are kept for context only. They must not
            // look like they cost points, so they get a neutral marker instead
            // of a green check or a red cross.
            const informational = item.weight === 0;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.5 + idx * 0.1 }}
                className="flex items-center gap-2.5 rounded-lg border border-card-border bg-background/50 px-3 py-2.5"
                data-testid={`checklist-item-${idx}`}
              >
                {informational ? (
                  <Info className="h-4 w-4 shrink-0 text-muted-foreground" data-testid={`icon-info-${idx}`} />
                ) : item.passed ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-primary" data-testid={`icon-check-${idx}`} />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" data-testid={`icon-x-${idx}`} />
                )}
                <div className="flex-1">
                  <p className={`text-xs font-medium ${informational || !item.passed ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {item.label}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {informational ? 'info' : `${Math.round(item.weight * 100)}%`}
                </span>
              </motion.div>
            );
          })}
          </div>
        </div>
        </div>
      </div>
    </motion.div>
  );
}
