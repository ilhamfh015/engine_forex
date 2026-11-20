import { motion } from 'framer-motion';
import { CalendarClock, ExternalLink, Newspaper, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { NewsRisk } from '@workspace/api-client-react';
import { formatWib } from '@/lib/format';

interface NewsRiskCardProps {
  risk: NewsRisk;
  index: number;
}

const STATUS_COPY: Record<NewsRisk['status'], { label: string; className: string; panel: string }> = {
  CLEAR: { label: 'AMAN', className: 'text-primary', panel: 'border-primary/25 bg-primary/5' },
  CAUTION: { label: 'WASPADA', className: 'text-amber-500', panel: 'border-amber-500/25 bg-amber-500/5' },
  HIGH_RISK: { label: 'RISIKO TINGGI', className: 'text-destructive', panel: 'border-destructive/25 bg-destructive/5' },
  UNAVAILABLE: { label: 'TIDAK TERSEDIA', className: 'text-amber-500', panel: 'border-amber-500/25 bg-amber-500/5' },
};

function formatAge(publishedAt: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(publishedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m lalu`;
  return `${Math.round(minutes / 60)}j lalu`;
}

export function NewsRiskCard({ risk, index }: NewsRiskCardProps) {
  const safeRisk = {
    status: risk?.status ?? ('UNAVAILABLE' as const),
    riskScore: risk?.riskScore ?? 60,
    headline: risk?.headline ?? 'Data berita belum tersedia. Skor disesuaikan; setup tetap ditampilkan.',
    source: risk?.source ?? 'API',
    fetchedAt: risk?.fetchedAt ?? new Date(0).toISOString(),
    windowMinutes: risk?.windowMinutes ?? 180,
    items: risk?.items ?? [],
    upcomingEvents: risk?.upcomingEvents ?? [],
  };
  const copy = STATUS_COPY[safeRisk.status];
  const Icon = safeRisk.status === 'CLEAR' ? ShieldCheck : ShieldAlert;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="panel panel-pad"
      aria-label="Risiko berita"
      data-testid="card-news-risk"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
            Konteks berita
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Risiko headline</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Headline relevan {safeRisk.windowMinutes} menit terakhir — bukan prediksi harga.
          </p>
        </div>
        <span className={`pill ${copy.panel} ${copy.className} border`}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {copy.label}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-3">
          <span className="metric-label">Skor risiko</span>
          <span className={`num text-2xl font-bold leading-none ${copy.className}`}>{safeRisk.riskScore}</span>
          <span className="text-[11px] text-muted-foreground">/100</span>
        </div>
        <p
          className={`rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-[13px] leading-relaxed ${
            safeRisk.status === 'CLEAR' ? 'text-foreground' : copy.className
          }`}
        >
          {safeRisk.headline}
        </p>
      </div>

      {safeRisk.items.length > 0 && (
        <div className="mt-4 space-y-2">
          {safeRisk.items.slice(0, 3).map((item) => (
            <a
              key={`${item.url}-${item.publishedAt}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-colors hover:border-border hover:bg-card"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {item.source} · {formatAge(item.publishedAt)} · {item.impact}
                </span>
              </span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}

      {safeRisk.upcomingEvents.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="metric-label flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Jadwal rilis terdekat
            </p>
            <span className="text-[10px] text-muted-foreground">WIB</span>
          </div>
          <div className="space-y-2">
            {safeRisk.upcomingEvents.map((event) => (
              <div
                key={`${event.country}-${event.title}-${event.scheduledAt}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">{event.title}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {event.country} · Forecast: {event.forecast || '—'} · Previous: {event.previous || '—'}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-right text-[11px] font-bold ${
                    event.impact === 'HIGH'
                      ? 'text-destructive'
                      : event.impact === 'MEDIUM'
                        ? 'text-amber-500'
                        : 'text-muted-foreground'
                  }`}
                >
                  <span className="block">{event.impact}</span>
                  <span className="num mt-0.5 block font-medium text-foreground">{formatWib(event.scheduledAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
}
