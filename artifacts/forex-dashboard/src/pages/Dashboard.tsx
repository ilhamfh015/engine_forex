import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock3, WifiOff } from 'lucide-react';
import { Header } from '@/components/Header';
import { TrendCard } from '@/components/TrendCard';
import { ConfidenceCard } from '@/components/ConfidenceCard';
import { SummaryCard } from '@/components/SummaryCard';
import { PairsOverview } from '@/components/PairsOverview';
import { TradingViewWidget } from '@/components/TradingViewWidget';
import { TradeSetupCard } from '@/components/TradeSetupCard';
import { NewsRiskCard } from '@/components/NewsRiskCard';
import { OverviewBar } from '@/components/OverviewBar';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/use-now';
import { candleFreshness, formatDuration, formatPrice, formatWib, marketKind } from '@/lib/format';
import {
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useGetAllPairsSummary,
  getGetAllPairsSummaryQueryKey,
} from '@workspace/api-client-react';

type Pair = 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'XAUUSD' | 'BTCUSD';

export default function Dashboard() {
  const [selectedPair, setSelectedPair] = useState<Pair>('EURUSD');
  const queryClient = useQueryClient();
  const now = useNow();

  const {
    data: analysis,
    isLoading: isLoadingAnalysis,
    isFetching: isFetchingAnalysis,
    error: analysisError,
    dataUpdatedAt,
  } = useGetAnalysis(selectedPair, {
    query: {
      queryKey: getGetAnalysisQueryKey(selectedPair),
      enabled: !!selectedPair,
      refetchInterval: 60000, // Auto-refresh every 60s
    },
  });

  const { data: allPairs } = useGetAllPairsSummary({
    query: {
      queryKey: getGetAllPairsSummaryQueryKey(),
      // The pair overview uses the same 15m/60m Twelve Data cache. Do not
      // refetch it every minute or it creates an unnecessary API burst.
      enabled: !!analysis,
      staleTime: 15 * 60 * 1000,
      refetchInterval: 15 * 60 * 1000,
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(selectedPair) });
    queryClient.invalidateQueries({ queryKey: getGetAllPairsSummaryQueryKey() });
  };

  const handlePairChange = (pair: string) => {
    setSelectedPair(pair as Pair);
  };

  if (isLoadingAnalysis && !analysis) {
    return <DashboardSkeleton />;
  }

  if (!analysis && analysisError) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
        <div className="panel w-full max-w-md p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10">
            <WifiOff className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">Gagal memuat analisa</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Data pasar tidak bisa diambil saat ini. Periksa koneksi atau kunci API, lalu coba lagi.
          </p>
          <Button onClick={handleRefresh} className="mt-5">
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return <DashboardSkeleton />;
  }

  const market = marketKind(selectedPair);
  const freshness = candleFreshness(analysis.trendM15.candleTime, now, 15, market);
  const cryptoFeedLag = market === 'crypto' && freshness.state === 'stale' && freshness.ageMinutes > 120;
  const bannerSevere = freshness.state === 'closed' || freshness.ageMinutes > 120;
  const bannerTitle =
    freshness.state === 'closed'
      ? 'Pasar kemungkinan sedang tutup.'
      : cryptoFeedLag
        ? 'Feed data kripto tertinggal.'
        : 'Candle terakhir sudah agak lama.';
  const bannerBody =
    freshness.state === 'closed'
      ? 'Bias, skor, dan level di bawah berasal dari kondisi sebelum pasar tutup — jangan dipakai sebagai kondisi terkini.'
      : cryptoFeedLag
        ? `${selectedPair} diperdagangkan 24/7, jadi ini keterlambatan data dari feed — bukan pasar tutup. Jangan pakai bias, skor, dan level di bawah sebagai kondisi terkini.`
        : 'Feed data mungkin terlambat; periksa ulang sebelum memakai level di bawah.';

  return (
    <div className="min-h-screen bg-background" data-testid="page-dashboard">
      <Header
        selectedPair={selectedPair}
        onPairChange={handlePairChange}
        onRefresh={handleRefresh}
        isRefreshing={isFetchingAnalysis}
        lastUpdate={analysis.timestamp}
        dataUpdatedAt={dataUpdatedAt}
        pairSummaries={allPairs}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {analysisError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
          >
            <span className="flex items-start gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              Refresh gagal. Yang tampil adalah analisa terakhir yang berhasil — periksa kesegaran data sebelum dipakai.
            </span>
            <button
              onClick={handleRefresh}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Coba lagi
            </button>
          </div>
        )}

        <div className="hidden print:block">
          <h1 className="text-xl font-bold text-foreground">Analisa {selectedPair} — Forex Market Structure</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Analisa dibuat {formatWib(analysis.timestamp, true)} WIB · Candle M15 terakhir{' '}
            {formatWib(analysis.trendM15.candleTime)} WIB
          </p>
          <p className="mt-1 text-xs text-foreground">
            Harga {formatPrice(analysis.trendM15.currentPrice, selectedPair)} · Bias {analysis.summary.bias} · Skor{' '}
            {analysis.confidence}/100 ({analysis.confidenceLevel}) · Status {analysis.tradeSetup.entryZoneLabel}
          </p>
        </div>

        {freshness.state !== 'fresh' && (
          <div
            role="status"
            className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm print:hidden ${
              bannerSevere ? 'border-amber-500/30 bg-amber-500/10' : 'border-border bg-muted/40'
            }`}
            data-testid="banner-candle-freshness"
          >
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span className="text-foreground">
              <strong className="font-semibold">{bannerTitle}</strong>{' '}
              Candle M15 terakhir {formatWib(analysis.trendM15.candleTime)} WIB, sekitar{' '}
              {formatDuration(freshness.ageMinutes)} lalu. {bannerBody}
            </span>
          </div>
        )}

        <OverviewBar analysis={analysis} pair={selectedPair} />

        <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
          <div className="space-y-6 xl:col-span-2">
            <TradeSetupCard setup={analysis.tradeSetup} pair={selectedPair} index={1} />

            <div className="grid gap-6 md:grid-cols-2">
              <TrendCard timeframe="H1" trend={analysis.trendH1} index={2} />
              <TrendCard timeframe="M15" trend={analysis.trendM15} index={3} />
            </div>
          </div>

          <div className="space-y-6">
            <ConfidenceCard
              confidence={analysis.confidence}
              confidenceLevel={analysis.confidenceLevel}
              checklist={analysis.checklist}
              index={4}
            />
            <SummaryCard summary={analysis.summary} note={analysis.note} index={5} />
          </div>
        </div>

        {allPairs && allPairs.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <PairsOverview pairs={allPairs} selectedPair={selectedPair} onPairSelect={handlePairChange} />
          </motion.div>
        )}

        <NewsRiskCard risk={analysis.newsRisk} index={6} />

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <TradingViewWidget pair={selectedPair} />
        </motion.div>

        <footer className="border-t border-border/60 pt-4 pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
          Analisa ini bersifat edukasi dan konteks, bukan rekomendasi investasi. Selalu verifikasi level dan risiko
          sebelum eksekusi.
        </footer>
      </main>
    </div>
  );
}
