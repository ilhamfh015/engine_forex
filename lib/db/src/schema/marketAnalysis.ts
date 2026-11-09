/**
 * Market Analysis Schema
 *
 * Stores snapshots of market analysis for each forex pair.
 * Used for history tracking and future ML training datasets.
 */
import { index, pgTable, serial, varchar, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketAnalysisTable = pgTable("market_analysis", {
  id: serial("id").primaryKey(),

  /** Currency pair (e.g. EURUSD) */
  pair: varchar("pair", { length: 10 }).notNull(),

  /** H1 trend direction: BUY or SELL */
  trendH1Direction: varchar("trend_h1_direction", { length: 4 }).notNull(),

  /** H1 market structure label e.g. HH-HL */
  trendH1Structure: varchar("trend_h1_structure", { length: 10 }).notNull(),

  /** H1 explanation */
  trendH1Explanation: text("trend_h1_explanation").notNull(),

  /** M15 trend direction: BUY or SELL */
  trendM15Direction: varchar("trend_m15_direction", { length: 4 }).notNull(),

  /** M15 market structure label e.g. LH-LL */
  trendM15Structure: varchar("trend_m15_structure", { length: 10 }).notNull(),

  /** M15 explanation */
  trendM15Explanation: text("trend_m15_explanation").notNull(),

  /** Entry confidence percentage 0-100 */
  confidence: real("confidence").notNull(),

  /** Confidence level: High, Medium, Low */
  confidenceLevel: varchar("confidence_level", { length: 10 }).notNull(),

  /** Overall market bias: BUY or SELL */
  bias: varchar("bias", { length: 4 }).notNull(),

  /** Narrative reason for the bias */
  reason: text("reason").notNull(),

  /** When this snapshot was recorded */
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("market_analysis_pair_created_at_idx").on(table.pair, table.createdAt),
]);

export const insertMarketAnalysisSchema = createInsertSchema(marketAnalysisTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMarketAnalysis = z.infer<typeof insertMarketAnalysisSchema>;
export type MarketAnalysis = typeof marketAnalysisTable.$inferSelect;
