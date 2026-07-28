/**
 * SummaryService
 *
 * Generates a human-readable market summary narrative
 * based on H1 trend, M15 trend, and entry confidence checklist.
 */

import type { TrendDirection } from "./MarketStructureService.js";
import type { ChecklistItem, ConfidenceLevel } from "./EntryConfidenceService.js";

export interface MarketSummary {
  bias: TrendDirection;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reason: string;
}

/**
 * Builds a multi-sentence reason string based on the analysis context.
 */
function buildReason(
  pair: string,
  h1Direction: TrendDirection,
  m15Direction: TrendDirection,
  checklist: ChecklistItem[],
): string {
  const lines: string[] = [];

  // Sentence 1: timeframe alignment
  if (h1Direction === m15Direction) {
    lines.push(`Trend H1 dan M15 sama-sama ${h1Direction}. Konfluensi timeframe terkonfirmasi.`);
  } else {
    lines.push(`Trend H1 ${h1Direction} namun M15 ${m15Direction}. Perlu perhatian lebih pada konfirmasi.`);
  }

  // Sentence 2: price position context
  const nearLevel = checklist.find((c) => c.label.includes("HL/LH") || c.label.includes("HL"));
  if (nearLevel?.passed) {
    const levelLabel = h1Direction === "BUY" ? "Higher Low" : "Lower High";
    lines.push(`Harga sedang retracement mendekati area ${levelLabel}.`);
  } else {
    lines.push(`Harga belum mencapai zona entry ideal. Tunggu retracement lebih dalam.`);
  }

  // Sentence 3: candle confirmation
  const confirmation = checklist.find((c) => c.label.includes("Confirmation"));
  if (confirmation?.passed) {
    const candleName = h1Direction === "BUY" ? "Bullish Engulfing" : "Bearish Engulfing";
    lines.push(`Muncul ${candleName} sebagai konfirmasi arah.`);
  } else {
    lines.push(`Belum ada konfirmasi candle yang kuat pada level ini.`);
  }

  // Sentence 4: risk/reward
  const rr = checklist.find((c) => c.label.includes("Risk Reward"));
  if (rr?.passed) {
    lines.push(`Risk Reward memenuhi syarat minimum 1:2.`);
  } else {
    lines.push(`Risk Reward belum memenuhi syarat. Pertimbangkan ulang level entry.`);
  }

  return lines.join(" ");
}

/**
 * Generates the full market summary for a given analysis context.
 *
 * @param pair - Currency pair string
 * @param h1Direction - Trend on H1
 * @param m15Direction - Trend on M15
 * @param confidence - Numeric confidence score 0-100
 * @param confidenceLevel - "High" | "Medium" | "Low"
 * @param checklist - Array of entry checklist items
 */
export function generateSummary(
  pair: string,
  h1Direction: TrendDirection,
  m15Direction: TrendDirection,
  confidence: number,
  confidenceLevel: ConfidenceLevel,
  checklist: ChecklistItem[],
): MarketSummary {
  // Bias follows H1 direction — H1 determines the trend
  const bias: TrendDirection = h1Direction;

  return {
    bias,
    confidence,
    confidenceLevel,
    reason: buildReason(pair, h1Direction, m15Direction, checklist),
  };
}
