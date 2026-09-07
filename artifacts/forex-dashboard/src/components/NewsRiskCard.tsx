import { motion } from 'framer-motion';
import { ExternalLink, Newspaper, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { NewsRisk } from '@workspace/api-client-react';

interface NewsRiskCardProps {
  risk: NewsRisk;
  index: number;
}

const statusCopy: Record<NewsRisk['status'], { label: string; color: string; panel: string }> = {
  CLEAR: { label: 'CLEAR', color: 'text-primary', panel: 'border-primary/25 bg-primary/5' },
  CAUTION: { label: 'CAUTION', color: 'text-yellow-500', panel: 'border-yellow-500/25 bg-yellow-500/5' },
  BLOCKED: { label: 'BLOCKED', color: 'text-destructive', panel: 'border-destructive/25 bg-destructive/5' },
  UNAVAILABLE: { label: 'UNAVAILABLE', color: 'text-yellow-500', panel: 'border-yellow-500/25 bg-yellow-500/5' },
};

function formatAge(publishedAt: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(publishedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m lalu`;
  return `${Math.round(minutes / 60)}j lalu`;
}

function formatJakarta(dateString: string) {
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateString))} WIB`;
}

export function NewsRiskCard({ risk, index }: NewsRiskCardProps) {
  const safeRisk = {
    status: risk?.status ?? 'UNAVAILABLE' as const,
    riskScore: risk?.riskScore ?? 100,
    headline: risk?.headline ?? 'Data berita belum tersedia. Entry diblokir sampai validasi selesai.',
    source: risk?.source ?? 'API',
    fetchedAt: risk?.fetchedAt ?? new Date(0).toISOString(),
    windowMinutes: risk?.windowMinutes ?? 180,
    items: risk?.items ?? [],
    upcomingEvents: risk?.upcomingEvents ?? [],
  };
  const copy = statusCopy[safeRisk.status];
  const Icon = safeRisk.status === 'CLEAR' ? ShieldCheck : ShieldAlert;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`rounded-xl border ${copy.panel} backdrop-blur-sm`}
      data-testid="card-news-risk"
    >
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">News Risk Filter</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Headline relevan dalam {safeRisk.windowMinutes} menit terakhir — bukan prediksi harga.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${copy.panel}`}>
            <Icon className={`h-4 w-4 ${copy.color}`} />
              <span className={`text-xs font-bold ${copy.color}`}>{copy.label}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-3 rounded-lg border border-card-border bg-card/60 px-4 py-3">
            <span className="text-xs text-muted-foreground">Risk score</span>
            <span className={`font-mono text-2xl font-bold ${copy.color}`}>{safeRisk.riskScore}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <p className={`rounded-lg border border-card-border bg-card/60 px-4 py-3 text-sm leading-relaxed ${safeRisk.status === 'CLEAR' ? 'text-foreground' : copy.color}`}>
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
                className="flex items-start justify-between gap-3 rounded-lg border border-card-border bg-card/40 p-3 transition-colors hover:bg-card/80"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item.source} · Terbit {formatJakarta(item.publishedAt)} ({formatAge(item.publishedAt)}) · {item.impact}
                  </span>
                </span>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}

        {safeRisk.upcomingEvents.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jadwal rilis terdekat</p>
              <span className="text-xs text-muted-foreground">Asia/Jakarta</span>
            </div>
            <div className="space-y-2">
              {safeRisk.upcomingEvents.slice(0, 4).map((event) => (
                <div
                  key={`${event.country}-${event.title}-${event.scheduledAt}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border bg-card/40 p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{event.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {event.country} · Forecast: {event.forecast || '—'} · Previous: {event.previous || '—'}
                    </span>
                  </span>
                  <span className={`shrink-0 text-right text-xs font-bold ${
                    event.impact === 'HIGH' ? 'text-destructive' : event.impact === 'MEDIUM' ? 'text-yellow-500' : 'text-muted-foreground'
                  }`}>
                    <span className="block">{event.impact}</span>
                    <span className="mt-1 block font-mono text-foreground">{formatJakarta(event.scheduledAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}