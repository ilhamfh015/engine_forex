/**
 * EntryConfidenceService
 *
 * Calculates entry confidence (0–100%) based on a weighted scoring
 * of multiple technical conditions.
 *
 * Weights:
 *   - Harga dekat HL/LH       35%
 *   - Confirmation Candle      25%
 *   - Momentum Candle          20%
 *   - Risk Reward Bagus        20%
 *
 * NOTE: Condition checks currently use deterministic simulation.
 * Replace each `checkXxx()` helper with real MT5 / price-feed logic
 * to use live market data.
 */

import type { TrendDirection } from "./MarketStructureService.js";

export interface ChecklistItem {
  label: string;
  passed: boolean;
  weight: number;
}

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  checklist: ChecklistItem[];
}

/** Condition weights — must sum to 1.0 */
const CONDITIONS: Array<{ label: string; weight: number }> = [
  { label: "Harga dekat HL/LH", weight: 0.35 },
  { label: "Confirmation Candle", weight: 0.25 },
  { label: "Momentum Candle", weight: 0.20 },
  { label: "Risk Reward Bagus", weight: 0.20 },
];

/**
 * Deterministic pseudo-random bit using pair + seed offset.
 * Returns true/false based on a simple hash.
 */
function conditionPassed(pair: string, conditionIndex: number, bias: TrendDirection): boolean {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const charSum = pair.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hash = (charSum * 3 + conditionIndex * 17 + bucket * 11) % 100;

  // BUY bias: conditions more likely to pass when structure aligns
  const threshold = bias === "BUY" ? 45 : 40;
  return hash > threshold;
}

/**
 * Maps a numeric score to a human-readable confidence level.
 */
function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 71) return "High";
  if (score >= 41) return "Medium";
  return "Low";
}

/**
 * Calculates entry confidence for a pair given the combined trend bias.
 *
 * @param pair   - Currency pair string
 * @param h1Direction - Trend direction on H1
 * @param m15Direction - Trend direction on M15
 */
export function calculateConfidence(
  pair: string,
  h1Direction: TrendDirection,
  m15Direction: TrendDirection,
): ConfidenceResult {
  // When both timeframes agree, conditions are more likely to be met
  const bias: TrendDirection = h1Direction === m15Direction ? h1Direction : h1Direction;

  const checklist: ChecklistItem[] = CONDITIONS.map((cond, i) => ({
    label: cond.label,
    passed: conditionPassed(pair, i, bias),
    weight: cond.weight,
  }));

  // Score = sum of weights for passed conditions × 100
  const rawScore = checklist.reduce((acc, item) => {
    return acc + (item.passed ? item.weight : 0);
  }, 0);

  // Bonus when H1 and M15 align — confidence floor raises to 30
  const alignmentBonus = h1Direction === m15Direction ? 0.05 : 0;
  const score = Math.min(100, Math.round((rawScore + alignmentBonus) * 100));

  return {
    score,
    level: scoreToLevel(score),
    checklist,
  };
}
