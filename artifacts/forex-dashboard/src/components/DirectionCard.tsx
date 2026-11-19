import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { DirectionForecast } from '@workspace/api-client-react';

interface DirectionCardProps {
  forecast: DirectionForecast;
  index?: number;
}

/**
 * Direction forecast card.
 *
 * Deliberately separate from the confluence score: this answers "which way
 * next", the other answers "is this a good entry". Mixing them would make both
 * numbers impossible to interpret.
 */
export function DirectionCard({ forecast, index = 0 }: DirectionCardProps) {
  const isBuy = forecast.direction === 'BUY';
  const tone = isBuy
    ? { text: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/25', bar: 'bg-primary' }
    : { text: 'text-destructive', bg: 'bg-destructive/5', border: 'border-destructive/25', bar: 'bg-destructive' };

  const strengthTone =
    forecast.strength === 'Kuat'
      ? tone
      : forecast.strength === 'Sedang'
        ? { text: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20', bar: 'bg-amber-400' }
        : { text: 'text-muted-foreground', bg: 'bg-muted/10', border: 'border-card-border', bar: 'bg-muted-foreground' };

  const top = forecast.factors.slice(0, 6);
  const maxAbs = Math.max(0.01, ...top.map((factor) => Math.abs(factor.contribution)));
  const Arrow = isBuy ? ArrowUpRight : ArrowDownRight;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="dashboard-panel overflow-hidden p-4 sm:p-5"
      aria-labelledby="direction-heading"
      data-testid="direction-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Prediksi arah
          </p>
          <h3 id="direction-heading" className="mt-1 text-sm text-muted-foreground">
            Peluang arah ±{forecast.barrierAtr} ATR dalam {forecast.horizonHours} jam ke depan
          </h3>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${strengthTone.text} ${strengthTone.bg} ${strengthTone.border}`}>
          {forecast.strength}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className={`rounded-xl border p-4 ${tone.bg} ${tone.border}`}>
          <div className="flex items-center gap-2">
            <Arrow className={`h-6 w-6 ${tone.text}`} />
            <span className={`text-2xl font-semibold tracking-tight ${tone.text}`} data-testid="direction-label">
              {forecast.direction}
            </span>
          </div>
          <div className="mt-3 flex items-end gap-1">
            <span className={`text-4xl font-semibold leading-none ${tone.text}`} data-testid="direction-score">
              {forecast.score}
            </span>
            <span className="pb-1 text-xs text-muted-foreground">/100</span>
          </div>
          <dl className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>Peluang naik</dt>
              <dd className="font-mono text-foreground">{(forecast.probabilityUp * 100).toFixed(0)}%</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Dasar {forecast.direction}</dt>
              <dd className="font-mono text-foreground">
                {((forecast.direction === 'BUY' ? forecast.baseRateUp : 1 - forecast.baseRateUp) * 100).toFixed(0)}%
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Selisih vs dasar</dt>
              <dd className={`font-mono ${forecast.edge >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {forecast.edge >= 0 ? '+' : ''}{(forecast.edge * 100).toFixed(1)} poin
              </dd>
            </div>
            {forecast.calibration && (
              <div className="flex justify-between gap-2">
                <dt>Riwayat skor {forecast.calibration.bucket}</dt>
                <dd className="font-mono text-foreground">
                  {(forecast.calibration.accuracy * 100).toFixed(0)}% <span className="text-muted-foreground">n={forecast.calibration.samples}</span>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pendorong utama
          </p>
          <ul className="mt-2 space-y-1.5">
            {top.map((factor) => {
              const positive = factor.contribution >= 0;
              const width = Math.min(50, (Math.abs(factor.contribution) / maxAbs) * 50);
              return (
                <li key={factor.label} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)_52px] items-center gap-2">
                  <span className="truncate text-[11px] text-muted-foreground" title={factor.label}>
                    {factor.label}
                  </span>
                  <span className="relative block h-1.5 rounded-full bg-muted/20" aria-hidden="true">
                    <span className="absolute left-1/2 top-0 h-full w-px bg-card-border" />
                    <span
                      className={`absolute top-0 h-full rounded-full ${positive ? 'bg-primary' : 'bg-destructive'}`}
                      style={{
                        width: `${width}%`,
                        left: positive ? '50%' : `${50 - width}%`,
                      }}
                    />
                  </span>
                  <span className={`text-right font-mono text-[11px] ${positive ? 'text-primary' : 'text-destructive'}`}>
                    {positive ? '+' : ''}{factor.contribution.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Bar ke kanan mendorong BUY, ke kiri mendorong SELL. Nilai adalah kontribusi log-odds model.
          </p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-card-border bg-background/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{forecast.note}</span>
      </p>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Holdout {new Date(forecast.validation.from).toLocaleDateString('id-ID')}–
        {new Date(forecast.validation.to).toLocaleDateString('id-ID')}: {' '}
        {(forecast.validation.accuracy * 100).toFixed(0)}% benar dari {forecast.validation.samples} sampel
        non-overlap (AUC {forecast.validation.auc.toFixed(2)}). Model {forecast.model}. TP/SL tetap keputusan Anda.
      </p>
    </motion.section>
  );
}
