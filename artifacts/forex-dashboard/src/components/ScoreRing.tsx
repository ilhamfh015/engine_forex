import type { ReactNode } from 'react';
import type { MarketAnalysisConfidenceLevel } from '@workspace/api-client-react';

const TONES = {
  High: {
    text: 'text-primary',
    stroke: 'stroke-primary',
    bar: 'bg-primary',
    soft: 'bg-primary/10',
    border: 'border-primary/25',
  },
  Medium: {
    text: 'text-amber-500',
    stroke: 'stroke-amber-500',
    bar: 'bg-amber-500',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/25',
  },
  Low: {
    text: 'text-destructive',
    stroke: 'stroke-destructive',
    bar: 'bg-destructive',
    soft: 'bg-destructive/10',
    border: 'border-destructive/25',
  },
} as const;

export function scoreTone(level: MarketAnalysisConfidenceLevel) {
  return TONES[level] ?? TONES.Low;
}

interface ScoreRingProps {
  value: number;
  level: MarketAnalysisConfidenceLevel;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
}

export function ScoreRing({ value, level, size = 132, strokeWidth = 9, children }: ScoreRingProps) {
  const tone = scoreTone(level);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Skor ${clamped} dari 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-border/60"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${tone.stroke} transition-[stroke-dashoffset] duration-700 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children ?? (
          <>
            <span className={`num text-3xl font-bold leading-none ${tone.text}`}>{clamped}</span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              / 100
            </span>
          </>
        )}
      </div>
    </div>
  );
}
