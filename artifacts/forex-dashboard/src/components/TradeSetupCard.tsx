import { motion } from 'framer-motion';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Crosshair, ShieldCheck, Target } from 'lucide-react';
import type { TradeSetup } from '@workspace/api-client-react';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { formatPrice, priceDecimals } from '@/lib/format';

interface TradeSetupCardProps {
  setup: TradeSetup;
  pair: string;
  index: number;
}

const STATUS_COPY: Record<TradeSetup['status'], { label: string; className: string; icon: typeof ShieldCheck }> = {
  READY: { label: 'Siap', className: 'text-primary border-primary/25 bg-primary/10', icon: ShieldCheck },
  WAIT: { label: 'Tunggu', className: 'text-muted-foreground border-border bg-muted/40', icon: Crosshair },
  CAUTION: { label: 'Waspada', className: 'text-amber-500 border-amber-500/25 bg-amber-500/10', icon: AlertTriangle },
};

function rewardMultiple(target: number, entry: number, stopLoss: number): number {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) return 0;
  return Math.abs(target - entry) / risk;
}

export function TradeSetupCard({ setup, pair, index }: TradeSetupCardProps) {
  const isBuy = setup.direction === 'BUY';
  const DirectionIcon = isBuy ? ArrowUpRight : ArrowDownRight;
  const status = STATUS_COPY[setup.status] ?? STATUS_COPY.WAIT;
  const StatusIcon = status.icon;

  const tone = isBuy ? 'text-primary' : 'text-destructive';
  const soft = isBuy ? 'border-primary/25 bg-primary/10' : 'border-destructive/25 bg-destructive/10';

  const risk = Math.abs(setup.entryPrice - setup.stopLoss);
  const reward = Math.abs(setup.tp2 - setup.entryPrice);
  const total = Math.max(risk + reward, Number.EPSILON);
  const riskPct = (risk / total) * 100;

  const distanceToZone =
    setup.currentPrice > setup.entryZoneMax
      ? setup.currentPrice - setup.entryZoneMax
      : setup.currentPrice < setup.entryZoneMin
        ? setup.entryZoneMin - setup.currentPrice
        : 0;
  const priceLocation =
    setup.currentPrice > setup.entryZoneMax
      ? `${formatPrice(distanceToZone, pair)} pts di atas zona entry`
      : setup.currentPrice < setup.entryZoneMin
        ? `${formatPrice(distanceToZone, pair)} pts di bawah zona entry`
        : 'Harga berada di dalam zona entry';

  const levels = [
    { label: 'TP3', value: setup.tp3, multiple: rewardMultiple(setup.tp3, setup.entryPrice, setup.stopLoss), className: 'text-primary' },
    { label: 'TP2', value: setup.tp2, multiple: rewardMultiple(setup.tp2, setup.entryPrice, setup.stopLoss), className: 'text-primary' },
    { label: 'TP1', value: setup.tp1, multiple: rewardMultiple(setup.tp1, setup.entryPrice, setup.stopLoss), className: 'text-primary' },
    { label: 'Stop loss', value: setup.stopLoss, multiple: null, className: 'text-destructive' },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="panel panel-pad"
      aria-label="Rencana trade"
      data-testid="card-trade-setup"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Rencana trade
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Zona entry &amp; level</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Zona berbasis EMA20 M15, invalidasi struktur, dan target ATR. Level hanya usulan, bukan perintah.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`pill ${soft} ${tone}`}>
            <DirectionIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {setup.direction}
          </span>
          <span className={`pill ${status.className}`}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {status.label}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="metric-label">Harga saat ini</p>
              <p className="num mt-2 text-2xl font-bold leading-none text-foreground">
                <AnimatedNumber value={setup.currentPrice} decimals={priceDecimals(pair)} />
              </p>
            </div>
            <span className="pill border-border text-muted-foreground">{setup.entryZoneLabel}</span>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">{priceLocation}</p>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>Risiko</span>
              <span>Reward (TP2)</span>
            </div>
            <div className="relative mt-2 flex h-3 overflow-hidden rounded-full border border-border/60">
              <div className="bg-destructive/55" style={{ width: `${riskPct}%` }} />
              <div className="bg-primary/55" style={{ width: `${100 - riskPct}%` }} />
              <div
                className="absolute inset-y-0 w-px bg-foreground/70"
                style={{ left: `${riskPct}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="num">SL {formatPrice(setup.stopLoss, pair)}</span>
              <span className="num text-foreground">Entry {formatPrice(setup.entryPrice, pair)}</span>
              <span className="num">TP2 {formatPrice(setup.tp2, pair)}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
            <div>
              <p className="metric-label">Risiko</p>
              <p className="num mt-0.5 text-xs font-semibold text-foreground">{formatPrice(setup.riskPoints, pair)} pts</p>
            </div>
            <div>
              <p className="metric-label">R : R</p>
              <p className="num mt-0.5 text-xs font-semibold text-foreground">1 : {Math.max(0, setup.riskRewardRatio).toFixed(2)}</p>
            </div>
            <div>
              <p className="metric-label">Zona</p>
              <p className="num mt-0.5 text-xs font-semibold text-foreground">
                {formatPrice(setup.entryZoneMin, pair)}–{formatPrice(setup.entryZoneMax, pair)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
          <p className="metric-label">Level harga</p>
          <div className="mt-2">
            <div className="level-row">
              <span className="text-xs text-muted-foreground">Zona entry</span>
              <span className={`num text-sm font-semibold ${tone}`}>
                {formatPrice(setup.entryZoneMin, pair)} – {formatPrice(setup.entryZoneMax, pair)}
              </span>
            </div>

            {levels.map((level) => (
              <div className="level-row" key={level.label}>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {level.label}
                  {level.multiple !== null ? (
                    <span className="num rounded border border-border/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                      {level.multiple.toFixed(1)}R
                    </span>
                  ) : null}
                </span>
                <span className={`num text-sm font-semibold ${level.className}`}>{formatPrice(level.value, pair)}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{setup.statusReason}</p>
        </div>
      </div>
    </motion.section>
  );
}
