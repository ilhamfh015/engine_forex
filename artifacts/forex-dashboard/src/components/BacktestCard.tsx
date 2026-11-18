import { useState } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import type {
  BacktestBucket,
  BacktestPeriod,
  ConfidenceBacktestReport,
} from '@workspace/api-client-react';

interface BacktestCardProps {
  report: ConfidenceBacktestReport;
}

type ScenarioKey = 'news-neutral' | 'news-unavailable';

const BAND_STYLES: Record<string, { label: string; hint: string; text: string; bg: string; border: string }> = {
  '55-100': {
    label: '55–100',
    hint: 'Sangat kuat',
    text: 'text-primary',
    bg: 'bg-primary/5',
    border: 'border-primary/25',
  },
  '45-54': {
    label: '45–54',
    hint: 'Sedang',
    text: 'text-amber-400',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/25',
  },
  '35-44': {
    label: '35–44',
    hint: 'Waspada',
    text: 'text-orange-400',
    bg: 'bg-orange-500/5',
    border: 'border-orange-500/25',
  },
  '0-34': {
    label: '0–34',
    hint: 'Lemah',
    text: 'text-destructive',
    bg: 'bg-destructive/5',
    border: 'border-destructive/25',
  },
};

const SCENARIO_LABELS: Record<ScenarioKey, { title: string; description: string }> = {
  'news-neutral': {
    title: 'News netral',
    description: 'Asumsi skor berita 0. Gunakan ini untuk membaca kualitas sinyal teknikal tanpa noise berita.',
  },
  'news-unavailable': {
    title: 'News tidak tersedia',
    description: 'Asumsi data berita tidak lengkap (risk 60). Gunakan ini untuk melihat ketahanan skor saat provider bermasalah.',
  },
};

function formatPct(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function formatR(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function formatDrawdown(value: number | null) {
  if (value === null) return '—';
  return value === 0 ? '0.00R' : `-${Math.abs(value).toFixed(2)}R`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function toneForBand(scoreBand: string) {
  return BAND_STYLES[scoreBand] ?? {
    label: scoreBand,
    hint: 'Tidak diketahui',
    text: 'text-muted-foreground',
    bg: 'bg-muted/40',
    border: 'border-card-border',
  };
}

function sortBucketsHighToLow(buckets: BacktestBucket[]) {
  const order = ['55-100', '45-54', '35-44', '0-34'];
  return [...buckets].sort((a, b) => order.indexOf(a.scoreBand) - order.indexOf(b.scoreBand));
}

function PeriodTable({ period, highlight }: { period: BacktestPeriod; highlight: boolean }) {
  const buckets = sortBucketsHighToLow(period.buckets);

  return (
    <div className={`min-w-0 rounded-xl border p-4 ${highlight ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-background/40'}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {period.name === 'out-of-sample' ? 'Out-of-sample' : 'Calibration'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatDate(period.from)} — {formatDate(period.to)}
          </p>
        </div>
        {highlight && (
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Holdout
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-card-border text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Band</th>
              <th className="pb-2 pr-3 text-right font-medium">Sinyal</th>
              <th className="pb-2 pr-3 text-right font-medium">Trade</th>
              <th className="pb-2 pr-3 text-right font-medium">Win</th>
              <th className="pb-2 pr-3 text-right font-medium">Exp 0.05R</th>
              <th className="pb-2 text-right font-medium">Max DD</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const tone = toneForBand(bucket.scoreBand);
              const lowSample = bucket.trades > 0 && bucket.trades < 5;
              return (
                <tr key={bucket.scoreBand} className="border-b border-card-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex min-w-14 justify-center rounded-md border px-2 py-1 font-mono text-[11px] font-semibold ${tone.border} ${tone.bg} ${tone.text}`}>
                        {tone.label}
                      </span>
                      <span className="text-muted-foreground">{tone.hint}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{bucket.signals}</td>
                  <td className="py-2 pr-3 text-right font-mono text-foreground">
                    {bucket.trades}
                    {lowSample && <span className="ml-1 text-amber-400" title="Sampel masih sedikit">*</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-foreground">{formatPct(bucket.winRate)}</td>
                  <td className={`py-2 pr-3 text-right font-mono font-semibold ${
                    bucket.expectancyNetRAt005Cost === null
                      ? 'text-muted-foreground'
                      : bucket.expectancyNetRAt005Cost >= 0
                        ? 'text-primary'
                        : 'text-destructive'
                  }`}>
                    {formatR(bucket.expectancyNetRAt005Cost)}
                  </td>
                  <td className="py-2 text-right font-mono text-muted-foreground">{formatDrawdown(bucket.maxDrawdownRAt005Cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {period.fineBuckets.filter((bucket) => bucket.signals > 0).length > 0 && (
        <details className="mt-3 rounded-lg border border-card-border bg-background/40 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-foreground">
            Distribusi skor 5 poin
          </summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full min-w-[320px] text-left text-[11px]">
              <thead className="sticky top-0 bg-background/95">
                <tr className="border-b border-card-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-1.5 pr-3 font-medium">Skor</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Sinyal</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Trade</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Win</th>
                  <th className="pb-1.5 text-right font-medium">Exp</th>
                </tr>
              </thead>
              <tbody>
                {period.fineBuckets
                  .filter((bucket) => bucket.signals > 0)
                  .map((bucket) => (
                    <tr key={bucket.scoreBand} className="border-b border-card-border/50 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-muted-foreground">{bucket.scoreBand}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground">{bucket.signals}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-foreground">{bucket.trades}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-foreground">{formatPct(bucket.winRate)}</td>
                      <td className={`py-1.5 text-right font-mono ${
                        bucket.expectancyNetRAt005Cost === null
                          ? 'text-muted-foreground'
                          : bucket.expectancyNetRAt005Cost >= 0
                            ? 'text-primary'
                            : 'text-destructive'
                      }`}>
                        {formatR(bucket.expectancyNetRAt005Cost)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

export function BacktestCard({ report }: BacktestCardProps) {
  const [scenario, setScenario] = useState<ScenarioKey>('news-neutral');
  const selected = report.scenarios.find((item) => item.scoreScenario === scenario) ?? report.scenarios[0];
  const periods = selected?.periods ?? [];
  const holdout = periods.find((period) => period.name === 'out-of-sample');
  const holdoutTrades = holdout?.buckets.reduce((sum, bucket) => sum + bucket.trades, 0) ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-3"
      data-testid="card-backtest"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Fokus pada kolom <strong className="font-semibold text-foreground">Out-of-sample</strong>, bukan calibration.
          Band yang sehat punya expectancy positif dan win rate lebih tinggi di holdout.
        </p>
        <div className="rounded-xl border border-card-border bg-background/50 px-3 py-2 text-right text-[11px] text-muted-foreground">
          <p>{report.candlesM15} candle M15 · {report.candlesH1} candle H1</p>
          <p className="mt-0.5">Split {formatDate(report.splitAt)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(SCENARIO_LABELS) as ScenarioKey[]).map((key) => {
          const active = key === scenario;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setScenario(key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-card-border bg-background/50 text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={active}
            >
              {SCENARIO_LABELS[key].title}
            </button>
          );
        })}
        <span className="text-[11px] text-muted-foreground">
          {scenario === 'news-neutral'
            ? 'Skenario utama'
            : 'Skenario ketahanan provider'}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {SCENARIO_LABELS[scenario].description}
      </p>

      {holdoutTrades === 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <span>Holdout belum menghasilkan trade yang cukup. Angka di bawah masih indikatif, bukan kesimpulan final.</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {periods.map((period) => (
          <PeriodTable
            key={period.name}
            period={period}
            highlight={period.name === 'out-of-sample'}
          />
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Win rate dan expectancy memakai friction 0.05R per trade. Tanda <span className="font-semibold text-amber-400">*</span> berarti
        sampel trade masih di bawah 5. Ini bukan probabilitas menang atau jaminan hasil.
      </p>

      <details className="mt-3 rounded-xl border border-card-border bg-background/40 px-3 py-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-foreground">
          Asumsi backtest
        </summary>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {report.assumptions.map((assumption) => (
            <li key={assumption} className="flex gap-2">
              <span aria-hidden="true">-</span>
              <span>{assumption}</span>
            </li>
          ))}
        </ul>
      </details>
    </motion.div>
  );
}
