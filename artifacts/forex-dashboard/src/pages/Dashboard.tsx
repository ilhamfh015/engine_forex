import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Header } from '@/components/Header';
import { TrendCard } from '@/components/TrendCard';
import { ConfidenceCard } from '@/components/ConfidenceCard';
import { SummaryCard } from '@/components/SummaryCard';
import { PairsOverview } from '@/components/PairsOverview';
import { TradingViewWidget } from '@/components/TradingViewWidget';
import { TradeSetupCard } from '@/components/TradeSetupCard';
import { NewsRiskCard } from '@/components/NewsRiskCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useGetAllPairsSummary,
  getGetAllPairsSummaryQueryKey,
} from '@workspace/api-client-react';

export default function Dashboard() {
  const [selectedPair, setSelectedPair] = useState<'EURUSD' | 'GBPUSD' | 'USDJPY' | 'XAUUSD' | 'BTCUSD'>('EURUSD');
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

  const { data: allPairs } = useGetAllPairsSummary({
    query: {
      queryKey: getGetAllPairsSummaryQueryKey(),
      // The pair overview uses the same 15m/60m Twelve Data cache. Do not
      // refetch it every minute or it creates an unnecessary API burst.
      enabled: !!analysis,
      staleTime: 15 * 60 * 1000,
      refetchInterval: 15 * 60 * 1000,
    }
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(selectedPair) });
    queryClient.invalidateQueries({ queryKey: getGetAllPairsSummaryQueryKey() });
  };

  const handlePairChange = (pair: string) => {
    setSelectedPair(pair as typeof selectedPair);
  };

  if (isLoadingAnalysis && !analysis) {
    return <LoadingSpinner fullPage />;
  }

  if (!analysis && analysisError) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Analysis</h2>
          <p className="text-muted-foreground mb-4">Failed to fetch market data</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return <LoadingSpinner fullPage />;
  }

  return (
    <div className="min-h-screen bg-background" data-testid="page-dashboard">
      <Header
        selectedPair={selectedPair}
        onPairChange={handlePairChange}
        onRefresh={handleRefresh}
        isRefreshing={isFetchingAnalysis}
        lastUpdate={analysis.timestamp}
      />

      <main className="container mx-auto px-4 py-8 space-y-8">
        {analysisError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-foreground"
          >
            <span>Refresh failed. Showing the last successful analysis; verify data freshness before using it.</span>
            <button
              onClick={handleRefresh}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Main Analysis Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <TrendCard timeframe="H1" trend={analysis.trendH1} index={0} />
          <TrendCard timeframe="M15" trend={analysis.trendM15} index={1} />
          <ConfidenceCard
            confidence={analysis.confidence}
            confidenceLevel={analysis.confidenceLevel}
            checklist={analysis.checklist}
            index={2}
          />
          <SummaryCard summary={analysis.summary} index={3} />
        </div>

        <TradeSetupCard setup={analysis.tradeSetup} pair={selectedPair} index={4} />
        <NewsRiskCard risk={analysis.newsRisk} index={5} />

        {/* All Pairs Overview */}
        {allPairs && allPairs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <PairsOverview
              pairs={allPairs}
              selectedPair={selectedPair}
              onPairSelect={handlePairChange}
            />
          </motion.div>
        )}

        {/* TradingView Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <TradingViewWidget pair={selectedPair} />
        </motion.div>
      </main>
    </div>
  );
}
