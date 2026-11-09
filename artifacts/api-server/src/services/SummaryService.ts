/**
 * SummaryService
 *
 * Generates a human-readable market summary narrative
 * based on H1 trend, M15 trend, and entry confidence checklist.
 */

import type { TrendDirection } from "./MarketStructureService.js";
import type { MarketState } from "./MarketStructureService.js";
import type { ChecklistItem, ConfidenceLevel } from "./EntryConfidenceService.js";
import type { NewsRisk } from "./NewsService.js";

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
  h1State: MarketState,
  m15State: MarketState,
  newsRisk: NewsRisk,
): string {
  const lines: string[] = [];

  if (h1State !== "TRENDING" || m15State !== "TRENDING") {
    lines.push(`Perhatian: state tren belum kuat (H1 ${h1State}, M15 ${m15State}); skor konfluensi diturunkan, tetapi setup tidak diblokir.`);
  }

  // Sentence 1: timeframe alignment. Matching directions alone are not
  // enough; both timeframes must be in a confirmed trend state.
  if (h1Direction === m15Direction && h1State === "TRENDING" && m15State === "TRENDING") {
    lines.push(`Trend H1 dan M15 sama-sama ${h1Direction}. Konfluensi timeframe terkonfirmasi.`);
  } else if (h1Direction === m15Direction) {
    lines.push(`Arah H1 dan M15 sama-sama ${h1Direction}, tetapi state belum sama-sama trending; perlakukan sinyal sebagai lebih berisiko.`);
  } else {
    lines.push(`Trend H1 ${h1Direction} namun M15 ${m15Direction}; skor alignment lebih rendah dan sinyal perlu perhatian ekstra.`);
  }

  // Sentence 2: price position context
  const inValueZone = checklist.find((c) => c.label === "Harga di Value Zone");
  if (inValueZone?.passed) {
    const levelLabel = h1Direction === "BUY" ? "Higher Low" : "Lower High";
    lines.push(`Harga sedang retracement mendekati area ${levelLabel}.`);
  } else {
    lines.push(`Harga belum mencapai zona entry ideal. Tunggu retracement lebih dalam.`);
  }

  // Sentence 3: candle confirmation
  const confirmation = checklist.find((c) => c.label.includes("Confirmation"));
  if (confirmation?.passed) {
    lines.push(`Candle tertutup terakhir mendukung arah ${h1Direction}.`);
  } else {
    lines.push(`Belum ada konfirmasi candle yang kuat pada level ini.`);
  }

  // Sentence 4: risk/reward
  const rr = checklist.find((c) => c.label.includes("Risk Reward"));
  if (rr?.passed) {
    lines.push(`RR rencana memenuhi acuan 1:1.5.`);
  } else {
    lines.push(`RR rencana di bawah acuan 1:1.5; faktor ini menurunkan skor.`);
  }

  if (newsRisk.status === "HIGH_RISK") {
    lines.push(`Risiko berita tinggi (mengurangi skor, bukan memblokir setup): ${newsRisk.headline}`);
  } else if (newsRisk.status === "CAUTION") {
    lines.push(`Risiko berita sedang: ${newsRisk.headline}`);
  } else if (newsRisk.status === "UNAVAILABLE") {
    lines.push("Data berita tidak lengkap; skor disesuaikan dan rencana tetap ditampilkan.");
  } else {
    lines.push("Tidak ada risiko berita utama yang terdeteksi pada sumber yang diperiksa.");
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
  h1State: MarketState = "TRENDING",
  m15State: MarketState = "TRENDING",
  newsRisk: NewsRisk = {
    status: "CLEAR",
    riskScore: 0,
    headline: "Tidak ada headline relevan terbaru.",
    source: "internal",
    fetchedAt: new Date(0).toISOString(),
    windowMinutes: 180,
    items: [],
    upcomingEvents: [],
  },
): MarketSummary {
  // Bias follows H1 direction — H1 determines the trend
  const bias: TrendDirection = h1Direction;

  return {
    bias,
    confidence,
    confidenceLevel,
    reason: buildReason(pair, h1Direction, m15Direction, checklist, h1State, m15State, newsRisk),
  };
}
