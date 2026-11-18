/**
 * Analysis Routes — DashboardController
 *
 * Handles all /analysis/* endpoints.
 * All business logic is delegated to the respective services.
 * This controller is intentionally thin — only HTTP in/out.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetAnalysisParams,
  GetAnalysisHistoryParams,
} from "@workspace/api-zod";
import { analyzeTrendFromCandles, SUPPORTED_PAIRS } from "../services/MarketStructureService.js";
import { calculateConfidence } from "../services/EntryConfidenceService.js";
import { generateSummary } from "../services/SummaryService.js";
import { applySetupAdvisory, buildTradeSetup } from "../services/TradeSetupService.js";
import { getCandles, getClosedCandles } from "../services/TwelveDataService.js";
import { getNewsRisk } from "../services/NewsService.js";
import {
  runConfidenceBacktest,
  type ConfidenceBacktestReport,
} from "../services/ConfidenceBacktestService.js";
import { db, marketAnalysisTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// Backtest replay is CPU-bound and requests a much longer candle history than
// the live dashboard. Cache it separately so repeated UI opens do not keep
// asking the provider for the same window.
const BACKTEST_M15_CANDLES = 1000;
const BACKTEST_H1_CANDLES = 400;
const BACKTEST_CACHE_TTL_MS = 30 * 60 * 1000;
const backtestCache = new Map<string, { value: ConfidenceBacktestReport; expiresAt: number }>();

/**
 * GET /analysis/:pair
 *
 * Returns the full market analysis for a currency pair using live Twelve Data candles.
 * Fetches H1 and M15 candles in parallel (served from cache after first call).
 */
router.get("/analysis/:pair", async (req: Request, res: Response) => {
  const parsed = GetAnalysisParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid currency pair. Supported: EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD" });
    return;
  }

  const { pair } = parsed.data;

  try {
    // 1. Fetch live candles for both timeframes in parallel (cached per TTL)
    //    100 candles gives enough warm-up for EMA50 and confirmed swing structure.
    const [candlesH1, candlesM15, newsRisk] = await Promise.all([
      getCandles(pair, "H1", 100),
      getCandles(pair, "M15", 100),
      getNewsRisk(pair),
    ]);

    // 2. Analyze only closed candles. Twelve Data may include the currently
    //    forming candle, which must never create a confirmed trend signal.
    const closedH1 = getClosedCandles(candlesH1);
    const closedM15 = getClosedCandles(candlesM15);
    const trendH1 = analyzeTrendFromCandles(closedH1);
    const trendM15 = analyzeTrendFromCandles(closedM15);

    // 3. Build trade setup before confidence so the score uses the actual
    // planned entry midpoint → TP2 RR rather than a separate approximation.
    const initialTradeSetup = buildTradeSetup(
      pair,
      trendH1.direction,
      closedM15,
      trendH1.marketState,
      trendM15.marketState,
      trendM15.direction,
    );

    // 4. Calculate entry confidence using the actual setup, both trend objects,
    // and the current headline-risk state.
    const confidence = calculateConfidence(
      pair,
      trendH1,
      trendM15,
      closedM15,
      initialTradeSetup.riskRewardRatio,
      newsRisk,
    );
    const { score, level, checklist, timeframeAligned, tradeAllowed, note, advisories } = confidence;
    const tradeSetup = applySetupAdvisory(initialTradeSetup, {
      score,
      timeframeAligned,
      checklist,
      newsStatus: newsRisk.status,
    });

    // 5. Generate market summary
    const summary = generateSummary(
      pair,
      trendH1.direction,
      trendM15.direction,
      score,
      level,
      checklist,
      trendH1.marketState,
      trendM15.marketState,
      newsRisk,
    );

    // 6. Persist snapshot to database (fire-and-forget, do not block response)
    if (db) {
      db.insert(marketAnalysisTable)
        .values({
          pair,
          trendH1Direction: trendH1.direction,
          trendH1Structure: trendH1.structure,
          trendH1Explanation: trendH1.explanation,
          trendM15Direction: trendM15.direction,
          trendM15Structure: trendM15.structure,
          trendM15Explanation: trendM15.explanation,
          confidence: score,
          confidenceLevel: level,
          bias: summary.bias,
          reason: summary.reason,
        })
        .catch((err) => {
          req.log.warn({ err }, "Failed to persist analysis snapshot");
        });
    }

    // 7. Return full analysis
    res.json({
      pair,
      timestamp: new Date().toISOString(),
      trendH1,
      trendM15,
      confidence: score,
      confidenceLevel: level,
      advisories,
      checklist,
      summary,
      timeframeAligned,
      tradeAllowed,
      note,
      tradeSetup,
      newsRisk,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating analysis");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /analysis/:pair/backtest
 *
 * Replays the live M15 setup logic over a longer candle history and returns
 * calibration and chronological holdout results grouped by score band.
 * The report is cached in memory; it never writes to the database.
 */
router.get("/analysis/:pair/backtest", async (req: Request, res: Response) => {
  const parsed = GetAnalysisParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid currency pair. Supported: EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD" });
    return;
  }

  const { pair } = parsed.data;
  const cached = backtestCache.get(pair);
  if (cached && Date.now() < cached.expiresAt) {
    res.json(cached.value);
    return;
  }

  try {
    const [candlesM15, candlesH1] = await Promise.all([
      getCandles(pair, "M15", BACKTEST_M15_CANDLES),
      getCandles(pair, "H1", BACKTEST_H1_CANDLES),
    ]);
    const report = runConfidenceBacktest(pair, candlesM15, candlesH1);

    backtestCache.set(pair, {
      value: report,
      expiresAt: Date.now() + BACKTEST_CACHE_TTL_MS,
    });

    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Error generating confidence backtest");
    const message = err instanceof Error ? err.message : "Internal server error";
    const insufficientHistory = /Not enough closed/.test(message);
    res.status(insufficientHistory ? 422 : 500).json({
      error: insufficientHistory
        ? `Riwayat candle belum cukup untuk backtest ${pair}. Coba lagi beberapa saat lagi.`
        : "Backtest gagal dijalankan. Cek koneksi dan API key Twelve Data.",
    });
  }
});

/**
 * GET /analysis/:pair/history
 *
 * Returns the last 20 stored analysis snapshots for a pair.
 * Ordered newest-first.
 */
router.get("/analysis/:pair/history", async (req: Request, res: Response) => {
  const parsed = GetAnalysisHistoryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid currency pair." });
    return;
  }

  const { pair } = parsed.data;

  if (!db) {
    res.status(503).json({ error: "Analysis history is unavailable because DATABASE_URL is not configured." });
    return;
  }

  try {
    const rows = await db
      .select({
        id: marketAnalysisTable.id,
        pair: marketAnalysisTable.pair,
        timestamp: marketAnalysisTable.createdAt,
        trendH1Direction: marketAnalysisTable.trendH1Direction,
        trendM15Direction: marketAnalysisTable.trendM15Direction,
        confidence: marketAnalysisTable.confidence,
        confidenceLevel: marketAnalysisTable.confidenceLevel,
        bias: marketAnalysisTable.bias,
      })
      .from(marketAnalysisTable)
      .where(eq(marketAnalysisTable.pair, pair))
      .orderBy(desc(marketAnalysisTable.createdAt))
      .limit(20);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching analysis history");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /analysis/pairs/summary
 *
 * Returns a quick summary for all supported pairs using live Twelve Data candles.
 * Processes pairs sequentially to avoid burst API usage (cache handles repeat calls).
 */
router.get("/analysis/pairs/summary", async (req: Request, res: Response) => {
  try {
    // Process pairs sequentially so we never burst more than 2 concurrent
    // Twelve Data requests at once (H1 + M15 for one pair in parallel).
    // In-flight deduplication in TwelveDataService means repeated callers
    // share a single fetch, so the cache fills quickly after the first load.
    const summaries: Array<{
      pair: string;
      bias: string;
      confidence: number;
      confidenceLevel: string;
      trendH1: string;
      trendM15: string;
      newsStatus: string;
      timestamp: string;
    }> = [];

    for (const pair of SUPPORTED_PAIRS) {
      const [candlesH1, candlesM15, newsRisk] = await Promise.all([
        getCandles(pair, "H1", 100),
        getCandles(pair, "M15", 100),
        getNewsRisk(pair),
      ]);
      const closedH1 = getClosedCandles(candlesH1);
      const closedM15 = getClosedCandles(candlesM15);
      const trendH1 = analyzeTrendFromCandles(closedH1);
      const trendM15 = analyzeTrendFromCandles(closedM15);
      const tradeSetup = buildTradeSetup(
        pair,
        trendH1.direction,
        closedM15,
        trendH1.marketState,
        trendM15.marketState,
        trendM15.direction,
      );
      const { score, level, checklist } = calculateConfidence(
        pair,
        trendH1,
        trendM15,
        closedM15,
        tradeSetup.riskRewardRatio,
        newsRisk,
      );
      const summary = generateSummary(
        pair,
        trendH1.direction,
        trendM15.direction,
        score,
        level,
        checklist,
        trendH1.marketState,
        trendM15.marketState,
        newsRisk,
      );

      summaries.push({
        pair,
        bias: summary.bias,
        confidence: score,
        confidenceLevel: level,
        trendH1: trendH1.direction,
        trendM15: trendM15.direction,
        newsStatus: newsRisk.status,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(summaries);
  } catch (err) {
    req.log.error({ err }, "Error generating pairs summary");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;
