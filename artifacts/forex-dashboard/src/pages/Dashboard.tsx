import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Layers3 } from 'lucide-react';
import { Header } from '@/components/Header';
import { TrendCard } from '@/components/TrendCard';
import { ConfidenceCard } from '@/components/ConfidenceCard';
import { SummaryCard } from '@/components/SummaryCard';
import { PairsOverview } from '@/components/PairsOverview';
import { TradingViewWidget } from '@/components/TradingViewWidget';
import { TradeSetupCard } from '@/components/TradeSetupCard';
import { NewsRiskCard } from '@/components/NewsRiskCard';
import { BacktestCard } from '@/components/BacktestCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import {
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useGetAllPairsSummary,
  getGetAllPairsSummaryQueryKey,
  useGetAnalysisBacktest,
  getGetAnalysisBacktestQueryKey,
} from '@workspace/api-client-react';

export default function Dashboard() {
  const [selectedPair, setSelectedPair] = useState<'EURUSD' | 'GBPUSD' | 'USDJPY' | 'XAUUSD' | 'BTCUSD'>('EURUSD');
  const [isPairsOverviewOpen, setIsPairsOverviewOpen] = useState(false);
  const [isBacktestOpen, setIsBacktestOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: analysis, isLoading: isLoadingAnalysis, isFetching: isFetchingAnalysis, error: analysisError } = useGetAnalysis(
    selectedPair,
    {
      query: {
        queryKey: getGetAnalysisQueryKey(selectedPair),
        enabled: !!selectedPair,
        refetchInterval: 60000, // Auto-refresh every 60s
      }
    }
  );

  const { data: allPairs, isLoading: isLoadingAllPairs, error: allPairsError } = useGetAllPairsSummary({
    query: {
      queryKey: getGetAllPairsSummaryQueryKey(),
      // The pair overview uses the same 15m/60m Twelve Data cache. Do not
      // refetch it every minute or it creates an unnecessary API burst.
      enabled: !!analysis && isPairsOverviewOpen,
      staleTime: 15 * 60 * 1000,
      refetchInterval: 15 * 60 * 1000,
    }
  });

  const {
    data: backtest,
    isLoading: isLoadingBacktest,
    error: backtestError,
  } = useGetAnalysisBacktest(selectedPair, {
    query: {
      queryKey: getGetAnalysisBacktestQueryKey(selectedPair),
      enabled: isBacktestOpen,
      staleTime: 30 * 60 * 1000,
      refetchInterval: false,
    }
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(selectedPair) });
    if (isPairsOverviewOpen) {
      queryClient.invalidateQueries({ queryKey: getGetAllPairsSummaryQueryKey() });
    }
    if (isBacktestOpen) {
      queryClient.invalidateQueries({ queryKey: getGetAnalysisBacktestQueryKey(selectedPair) });
    }
  };

  const handlePairChange = (pair: string) => {
    setSelectedPair(pair as typeof selectedPair);
  };

  if (isLoadingAnalysis && !analysis) {
    return <LoadingSpinner fullPage />;
  }

  if (!analysis && analysisError) {
    return (
      <div className="dashboard-shell flex min-h-screen items-center justify-center px-4">
        <div className="dashboard-panel w-full max-w-md p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <span className="text-xl font-semibold" aria-hidden="true">!</span>
          </div>
          <h2 className="text-xl font-semibold text-foreground">Analisis belum tersedia</h2>
          <p className="mb-5 mt-2 text-sm leading-relaxed text-muted-foreground">
            Data pasar gagal dimuat. Periksa koneksi lalu coba lagi.
          </p>
          <Button
            onClick={handleRefresh}
            className="min-h-10"
            disabled={isFetchingAnalysis}
          >
            {isFetchingAnalysis ? 'Memuat ulang…' : 'Coba lagi'}
          </Button>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return <LoadingSpinner fullPage />;
  }

  return (
    <div className="dashboard-shell min-h-screen" data-testid="page-dashboard">
      <Header
        selectedPair={selectedPair}
        onPairChange={handlePairChange}
        onRefresh={handleRefresh}
        isRefreshing={isFetchingAnalysis}
        lastUpdate={analysis.timestamp}
      />

      <main className="mx-auto max-w-screen-2xl space-y-6 px-4 py-5 sm:space-y-7 sm:px-6 sm:py-8">
        <section className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Ringkasan pasar</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{selectedPair}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ringkasan tren dan konfluensi untuk H1 dan M15.</p>
          </div>
          <span className="rounded-full border border-card-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
            Data candle tertutup
          </span>
        </section>

        {analysisError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground"
          >
            <span>Gagal memperbarui data. Analisis terakhir tetap ditampilkan; pastikan waktu pembaruan sebelum digunakan.</span>
            <Button
              onClick={handleRefresh}
              size="sm"
              variant="outline"
              disabled={isFetchingAnalysis}
            >
              Coba lagi
            </Button>
          </div>
        )}

        <section aria-label="Analisis teknikal utama" className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-5">
          <TrendCard timeframe="H1" trend={analysis.trendH1} index={0} />
          <TrendCard timeframe="M15" trend={analysis.trendM15} index={1} />
          <ConfidenceCard
            confidence={analysis.confidence}
            confidenceLevel={analysis.confidenceLevel}
            checklist={analysis.checklist}
            advisories={analysis.advisories}
            index={2}
          />
          <SummaryCard summary={analysis.summary} index={3} />
        </section>

        <TradeSetupCard setup={analysis.tradeSetup} pair={selectedPair} index={4} />
        <NewsRiskCard risk={analysis.newsRisk} index={5} />

        <section className="dashboard-panel p-4 sm:p-5" aria-labelledby="backtest-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="backtest-heading" className="dashboard-section-title">Validasi skor</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Cek apakah band skor 55–100, 45–54, 35–44, dan 0–34 punya hasil historis yang berbeda.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-card-border"
              onClick={() => setIsBacktestOpen((open) => !open)}
              aria-expanded={isBacktestOpen}
              aria-controls="backtest-content"
            >
              {isBacktestOpen ? 'Sembunyikan' : 'Muat backtest'}
              <ChevronDown className={`h-4 w-4 transition-transform ${isBacktestOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          </div>
          {isBacktestOpen && (
            <div id="backtest-content" className="mt-4">
              {isLoadingBacktest && (
                <p className="text-sm text-muted-foreground" role="status">
                  Menjalankan replay historis… Ini bisa memakan waktu saat cache masih dingin.
                </p>
              )}
              {backtestError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm" role="alert">
                  <span>Backtest gagal dimuat. Riwayat candle mungkin belum cukup atau provider sedang sibuk.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: getGetAnalysisBacktestQueryKey(selectedPair) })}
                  >
                    Coba lagi
                  </Button>
                </div>
              )}
              {backtest && !isLoadingBacktest && <BacktestCard report={backtest} />}
            </div>
          )}
        </section>

        <section className="dashboard-panel p-4 sm:p-5" aria-labelledby="pairs-overview-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="pairs-overview-heading" className="dashboard-section-title">Pantauan pasangan</h3>
              <p className="mt-1 text-xs text-muted-foreground">Kondisi tren dan risiko dari lima instrumen.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-card-border"
              onClick={() => setIsPairsOverviewOpen((open) => !open)}
              aria-expanded={isPairsOverviewOpen}
              aria-controls="pairs-overview-content"
            >
              <Layers3 className="h-4 w-4" aria-hidden="true" />
              {isPairsOverviewOpen ? 'Sembunyikan' : 'Muat ringkasan'}
              <ChevronDown className={`h-4 w-4 transition-transform ${isPairsOverviewOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          </div>
          {isPairsOverviewOpen && (
            <div id="pairs-overview-content" className="mt-5 space-y-4">
              {isLoadingAllPairs && (
                <p className="text-sm text-muted-foreground" role="status">Memuat ringkasan instrumen…</p>
              )}
              {allPairsError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm" role="alert">
                  <span>Ringkasan instrumen gagal dimuat.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: getGetAllPairsSummaryQueryKey() })}
                  >
                    Coba lagi
                  </Button>
                </div>
              )}
              {allPairs && allPairs.length > 0 && (
                <PairsOverview
                  pairs={allPairs}
                  selectedPair={selectedPair}
                  onPairSelect={handlePairChange}
                />
              )}
            </div>
          )}
        </section>

        <div>
          <TradingViewWidget pair={selectedPair} />
        </div>

        <footer className="pb-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Alat bantu keputusan, bukan saran eksekusi otomatis. Skor dan status bersifat heuristik;
          selalu kelola risiko dan verifikasi sebelum entry.
        </footer>
      </main>
    </div>
  );
}
