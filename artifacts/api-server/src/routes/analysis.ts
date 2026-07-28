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
import { analyzeTrend, SUPPORTED_PAIRS } from "../services/MarketStructureService.js";
import { calculateConfidence } from "../services/EntryConfidenceService.js";
import { generateSummary } from "../services/SummaryService.js";
import { db, marketAnalysisTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /analysis/:pair
 *
 * Returns the full market analysis for a currency pair.
 * Generates analysis on-the-fly using services, then stores
 * a snapshot to the database for history tracking.
 */
router.get("/analysis/:pair", async (req: Request, res: Response) => {
  const parsed = GetAnalysisParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid currency pair. Supported: EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD" });
    return;
  }

  const { pair } = parsed.data;

  try {
    // 1. Analyze market structure for both timeframes
    const trendH1 = analyzeTrend(pair, "H1");
    const trendM15 = analyzeTrend(pair, "M15");

    // 2. Calculate entry confidence
    const { score, level, checklist } = calculateConfidence(pair, trendH1.direction, trendM15.direction);

    // 3. Generate market summary
    const summary = generateSummary(pair, trendH1.direction, trendM15.direction, score, level, checklist);

    // 4. Persist snapshot to database (fire-and-forget, do not block response)
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

    // 5. Return full analysis
    res.json({
      pair,
      timestamp: new Date().toISOString(),
      trendH1,
      trendM15,
      confidence: score,
      confidenceLevel: level,
      checklist,
      summary,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating analysis");
    res.status(500).json({ error: "Internal server error" });
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
 * Returns a quick summary for all supported pairs.
 * Generates on-the-fly — no DB read needed for this endpoint.
 */
router.get("/analysis/pairs/summary", async (req: Request, res: Response) => {
  try {
    const summaries = SUPPORTED_PAIRS.map((pair) => {
      const trendH1 = analyzeTrend(pair, "H1");
      const trendM15 = analyzeTrend(pair, "M15");
      const { score, level } = calculateConfidence(pair, trendH1.direction, trendM15.direction);
      const summary = generateSummary(pair, trendH1.direction, trendM15.direction, score, level, []);

      return {
        pair,
        bias: summary.bias,
        confidence: score,
        confidenceLevel: level,
        trendH1: trendH1.direction,
        trendM15: trendM15.direction,
        timestamp: new Date().toISOString(),
      };
    });

    res.json(summaries);
  } catch (err) {
    req.log.error({ err }, "Error generating pairs summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
