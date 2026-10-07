import { motion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, ShieldCheck, Target } from 'lucide-react';
import type { TradeSetup } from '@workspace/api-client-react';

interface TradeSetupCardProps {
  setup: TradeSetup;
  index: number;
}

function formatPrice(value: number, pipSize: number) {
  const decimals = pipSize >= 1 ? 0 : pipSize === 0.01 ? 2 : 5;
  return value.toFixed(decimals);
}

export function TradeSetupCard({ setup, index }: TradeSetupCardProps) {
  const isBuy = setup.direction === 'BUY';
  const isReady = setup.status === 'READY';
  const isCaution = setup.status === 'CAUTION';
  const accent = isBuy ? 'text-primary' : 'text-destructive';
  const border = isBuy ? 'border-primary/30' : 'border-destructive/30';
  const panel = isBuy ? 'bg-primary/5' : 'bg-destructive/5';
  const Icon = isCaution ? AlertTriangle : isReady ? ShieldCheck : Crosshair;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`rounded-xl border ${border} ${panel} backdrop-blur-sm`}
      data-testid="card-trade-setup"
    >
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Trade Plan</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Zona entry berbasis EMA20 M15 dengan invalidasi struktur dan target ATR.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${border} ${panel}`}>
            <Icon className={`h-4 w-4 ${isCaution ? 'text-yellow-500' : accent}`} />
            <span className={`text-xs font-bold ${isCaution ? 'text-yellow-500' : accent}`}>
              {setup.entryZoneLabel}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="rounded-lg border border-card-border bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="mt-1 font-mono text-sm font-semibold text-foreground">
              {formatPrice(setup.currentPrice, setup.pipSize)}
            </p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 md:col-span-2">
            <p className="text-xs text-muted-foreground">Ideal Entry Zone</p>
            <p className={`mt-1 font-mono text-sm font-bold ${accent}`}>
              {formatPrice(setup.entryZoneMin, setup.pipSize)} – {formatPrice(setup.entryZoneMax, setup.pipSize)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ref: {formatPrice(setup.entryPrice, setup.pipSize)}
            </p>
          </div>
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowDown className="h-3 w-3" /> Stop Loss</p>
            <p className="mt-1 font-mono text-sm font-bold text-destructive">
              {formatPrice(setup.stopLoss, setup.pipSize)}
            </p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUp className="h-3 w-3" /> TP1 / TP2</p>
            <p className="mt-1 font-mono text-sm font-bold text-primary">
              {formatPrice(setup.tp1, setup.pipSize)} / {formatPrice(setup.tp2, setup.pipSize)}
            </p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUp className="h-3 w-3" /> TP3 / RR</p>
            <p className="mt-1 font-mono text-sm font-bold text-primary">
              {formatPrice(setup.tp3, setup.pipSize)} / 1:{Math.max(0, setup.riskRewardRatio).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>Risk: <strong className="font-mono text-foreground">{formatPrice(setup.riskPoints, setup.pipSize)} pts</strong></span>
          <span className="text-foreground">{setup.statusReason}</span>
        </div>
      </div>
    </motion.section>
  );
}