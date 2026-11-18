/**
 * ScoreCalibrationService
 *
 * Offline helper for choosing confidence-band cutoffs from per-signal backtest
 * samples. It never writes to the database and it never changes live scoring.
 *
 * The intended workflow is:
 *   1. Fit candidate cutoffs on the calibration period only.
 *   2. Evaluate those cutoffs unchanged on the chronological holdout.
 *   3. Compare the fitted bands with the current fixed 35/45/55 bands.
 */

export interface CalibrationTrade {
  score: number;
  /** Net R after the assumed round-trip friction. */
  netR: number;
}

export interface CalibrationBandStat {
  key: string;
  min: number;
  max: number;
  trades: number;
  wins: number;
  winRate: number | null;
  expectancyNetR: number | null;
  totalNetR: number;
  maxDrawdownR: number | null;
}

export interface ScoreBandSuggestion {
  bands: CalibrationBandStat[];
  cutoffs: [number, number, number];
  minTradesUsed: number;
  reliable: boolean;
  warnings: string[];
}

const DEFAULT_CUTOFFS: [number, number, number] = [35, 45, 55];

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function average(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function drawdown(values: number[]): number | null {
  if (values.length === 0) return null;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return round(maxDrawdown);
}

function bandKey(min: number, maxExclusive: number): string {
  const max = maxExclusive >= 101 ? 100 : maxExclusive - 1;
  return `${min}-${max}`;
}

export function evaluateBand(
  trades: CalibrationTrade[],
  min: number,
  maxExclusive: number,
  key = bandKey(min, maxExclusive),
): CalibrationBandStat {
  const selected = trades.filter((trade) => trade.score >= min && trade.score < maxExclusive);
  const netRValues = selected.map((trade) => trade.netR);
  const wins = netRValues.filter((value) => value > 0).length;

  return {
    key,
    min,
    max: maxExclusive >= 101 ? 100 : maxExclusive - 1,
    trades: selected.length,
    wins,
    winRate: selected.length ? round(wins / selected.length * 100, 1) : null,
    expectancyNetR: average(netRValues),
    totalNetR: round(netRValues.reduce((sum, value) => sum + value, 0)),
    maxDrawdownR: drawdown(netRValues),
  };
}

export function evaluateScoreBands(
  trades: CalibrationTrade[],
  cutoffs: [number, number, number],
): CalibrationBandStat[] {
  const [orangeMin, yellowMin, greenMin] = cutoffs;
  return [
    evaluateBand(trades, 0, orangeMin),
    evaluateBand(trades, orangeMin, yellowMin),
    evaluateBand(trades, yellowMin, greenMin),
    evaluateBand(trades, greenMin, 101),
  ];
}

export function cumulativeCutoffTable(
  trades: CalibrationTrade[],
  step = 5,
): Array<CalibrationBandStat> {
  const rows: CalibrationBandStat[] = [];
  for (let cutoff = 0; cutoff <= 100; cutoff += step) {
    const selected = trades.filter((trade) => trade.score >= cutoff);
    const netRValues = selected.map((trade) => trade.netR);
    const wins = netRValues.filter((value) => value > 0).length;
    rows.push({
      key: `>=${cutoff}`,
      min: cutoff,
      max: 100,
      trades: selected.length,
      wins,
      winRate: selected.length ? round(wins / selected.length * 100, 1) : null,
      expectancyNetR: average(netRValues),
      totalNetR: round(netRValues.reduce((sum, value) => sum + value, 0)),
      maxDrawdownR: drawdown(netRValues),
    });
  }
  return rows;
}

function isMonotonic(bands: CalibrationBandStat[]): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    const value = band.expectancyNetR;
    if (value === null) return false;
    if (value < previous - 1e-9) return false;
    previous = value;
  }
  return true;
}

function monotonicPenalty(bands: CalibrationBandStat[]): number {
  let penalty = 0;
  for (let index = 1; index < bands.length; index++) {
    const previous = bands[index - 1].expectancyNetR ?? 0;
    const current = bands[index].expectancyNetR ?? 0;
    penalty += Math.max(0, previous - current);
  }
  return penalty;
}

interface CandidateOptions {
  minTrades?: number;
  gridStep?: number;
}

/**
 * Search ascending cutoffs on the calibration period. The objective rewards a
 * real gap between the top and bottom bands and penalises non-monotonic bands,
 * while requiring enough trades in every band to be readable.
 */
export function suggestScoreBands(
  trades: CalibrationTrade[],
  options: CandidateOptions = {},
): ScoreBandSuggestion {
  const requestedMinTrades = options.minTrades ?? 10;
  const gridStep = options.gridStep ?? 5;
  const warnings: string[] = [];

  if (trades.length === 0) {
    return {
      bands: evaluateScoreBands([], DEFAULT_CUTOFFS),
      cutoffs: DEFAULT_CUTOFFS,
      minTradesUsed: 0,
      reliable: false,
      warnings: ["No filled trades were available for calibration."],
    };
  }

  const grid: number[] = [];
  for (let value = 5; value <= 90; value += gridStep) grid.push(value);

  const thresholds = Array.from(new Set([requestedMinTrades, 10, 5, 3].filter((value) => value > 0)));

  for (const minTrades of thresholds) {
    let best:
      | { bands: CalibrationBandStat[]; cutoffs: [number, number, number]; objective: number; monotonic: boolean }
      | null = null;

    for (let a = 0; a < grid.length; a++) {
      for (let b = a + 1; b < grid.length; b++) {
        for (let c = b + 1; c < grid.length; c++) {
          const cutoffs: [number, number, number] = [grid[a], grid[b], grid[c]];
          const bands = evaluateScoreBands(trades, cutoffs);
          if (bands.some((band) => band.trades < minTrades)) continue;

          const red = bands[0].expectancyNetR ?? 0;
          const orange = bands[1].expectancyNetR ?? 0;
          const yellow = bands[2].expectancyNetR ?? 0;
          const green = bands[3].expectancyNetR ?? 0;
          const lift = (green - red) + 0.5 * (yellow - orange);
          const penalty = monotonicPenalty(bands);
          const monotonic = penalty === 0;
          const sampleBonus = Math.min(0.05, bands[3].trades * 0.002);
          const objective = lift + sampleBonus - penalty;

          if (!best || objective > best.objective || (objective === best.objective && green > (best.bands[3].expectancyNetR ?? 0))) {
            best = { bands, cutoffs, objective, monotonic };
          }
        }
      }
    }

    if (best) {
      if (minTrades < requestedMinTrades) {
        warnings.push(
          `Only ${minTrades} trades per band were available; the requested minimum was ${requestedMinTrades}.`,
        );
      }
      if (!best.monotonic) {
        warnings.push(
          "Bands are not perfectly monotonic in expectancy; treat the cutoffs as provisional.",
        );
      }
      return {
        bands: best.bands,
        cutoffs: best.cutoffs,
        minTradesUsed: minTrades,
        reliable: best.monotonic && minTrades >= requestedMinTrades,
        warnings,
      };
    }
  }

  warnings.push(
    "No cutoff combination satisfied the minimum trade requirement in all four bands. Showing the current 35/45/55 bands instead.",
  );
  return {
    bands: evaluateScoreBands(trades, DEFAULT_CUTOFFS),
    cutoffs: DEFAULT_CUTOFFS,
    minTradesUsed: 0,
    reliable: false,
    warnings,
  };
}
