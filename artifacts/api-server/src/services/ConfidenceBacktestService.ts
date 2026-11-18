import type { Candle } from "./TwelveDataService.js";
import { getClosedCandles } from "./TwelveDataService.js";
import { calculateConfidence, type ChecklistItem } from "./EntryConfidenceService.js";
import {
  analyzeTrendFromCandles,
  type MarketState,
  type TrendDirection,
} from "./MarketStructureService.js";
import { buildTradeSetup } from "./TradeSetupService.js";

const LIVE_WINDOW_CANDLES = 99;
const DEFAULT_PENDING_BARS = 8;
const DEFAULT_HOLD_BARS = 32;
const BASE_FRICTION_R = 0.05;

export const SCORE_BANDS = [
  { key: "0-34", min: 0, max: 34 },
  { key: "35-44", min: 35, max: 44 },
  { key: "45-54", min: 45, max: 54 },
  { key: "55-100", min: 55, max: 100 },
] as const;

export type ScoreScenario = "news-neutral" | "news-unavailable";

export interface BacktestBucket {
  scoreBand: string;
  signals: number;
  ordersPlaced: number;
  unfilledOrders: number;
  trades: number;
  wins: number;
  winRate: number | null;
  averageGrossR: number | null;
  expectancyNetRAt0Cost: number | null;
  expectancyNetRAt005Cost: number | null;
  expectancyNetRAt010Cost: number | null;
  maxDrawdownRAt005Cost: number | null;
}

export interface BacktestPeriod {
  name: "calibration" | "out-of-sample";
  from: string;
  to: string;
  buckets: BacktestBucket[];
  // Five-point score bins are intended for calibration research; the four
  // headline bands above stay stable for the dashboard.
  fineBuckets: BacktestBucket[];
  scoreHistogram: Array<{ scoreBucket: string; signals: number }>;
}

export type BacktestSampleOutcome = "win" | "loss" | "unfilled" | "not-simulated";

export interface BacktestSignalSample {
  pair: string;
  scoreScenario: ScoreScenario;
  period: "calibration" | "out-of-sample";
  signalAt: string;
  score: number;
  scoreBand: string;
  scoreBucket5: string;
  direction: TrendDirection;
  h1Direction: TrendDirection;
  m15Direction: TrendDirection;
  h1MarketState: MarketState;
  m15MarketState: MarketState;
  h1Structure: string;
  m15Structure: string;
  timeframeAligned: boolean;
  riskRewardRatio: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  orderSimulated: boolean;
  filled: boolean;
  outcome: BacktestSampleOutcome;
  grossR: number | null;
  netRAt005Cost: number | null;
  exitAt: string | null;
  checklist: ChecklistItem[];
}

export interface BacktestScenarioReport {
  scoreScenario: ScoreScenario;
  periods: BacktestPeriod[];
}

export interface ConfidenceBacktestReport {
  pair: string;
  entryTimeframe: "M15";
  confirmationTimeframe: "H1";
  candlesM15: number;
  candlesH1: number;
  m15From: string;
  m15To: string;
  splitAt: string;
  scenarios: BacktestScenarioReport[];
  assumptions: string[];
  // Only populated when the caller explicitly asks for per-signal research
  // data. The live API keeps the aggregate-only payload small.
  samples?: BacktestSignalSample[];
}

interface ReplayTrade {
  signalIndex: number;
  exitIndex: number;
  grossR: number;
}

interface BucketAccumulator {
  signals: number;
  ordersPlaced: number;
  unfilledOrders: number;
  trades: ReplayTrade[];
}

interface PeriodAccumulator {
  name: BacktestPeriod["name"];
  startIndex: number;
  endIndex: number;
  byScenario: Map<ScoreScenario, Map<string, BucketAccumulator>>;
  fineByScenario: Map<ScoreScenario, Map<string, BucketAccumulator>>;
  samples: BacktestSignalSample[];
}

interface OrderOutcome {
  filled: boolean;
  nextAvailableIndex: number;
  trade?: ReplayTrade;
}

const SCORE_SCENARIOS: Array<{
  key: ScoreScenario;
  status: "CLEAR" | "UNAVAILABLE";
  riskScore: number;
}> = [
  { key: "news-neutral", status: "CLEAR", riskScore: 0 },
  { key: "news-unavailable", status: "UNAVAILABLE", riskScore: 60 },
];

function candleTimeMs(candle: Candle): number {
  const raw = candle.datetime.trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid candle timestamp in historical data: ${candle.datetime}`);
  }
  return timestamp;
}

export function scoreBand(score: number): string {
  return SCORE_BANDS.find((band) => score >= band.min && score <= band.max)?.key ?? "55-100";
}

/**
 * Five-point research bin. The final bin is widened to 95-100 so the maximum
 * score is always represented.
 */
export function scoreBucket5(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const min = Math.min(95, Math.floor(clamped / 5) * 5);
  return min === 95 ? "95-100" : `${min}-${min + 4}`;
}

function fineBucketOrder(key: string): number {
  return Number.parseInt(key.split("-")[0] ?? "0", 10);
}

function createAccumulator(): BucketAccumulator {
  return { signals: 0, ordersPlaced: 0, unfilledOrders: 0, trades: [] };
}

function initPeriod(name: PeriodAccumulator["name"], startIndex: number, endIndex: number): PeriodAccumulator {
  const byScenario = new Map<ScoreScenario, Map<string, BucketAccumulator>>();
  const fineByScenario = new Map<ScoreScenario, Map<string, BucketAccumulator>>();
  for (const scenario of SCORE_SCENARIOS) {
    byScenario.set(scenario.key, new Map(SCORE_BANDS.map((band) => [band.key, createAccumulator()])));
    fineByScenario.set(scenario.key, new Map());
  }
  return { name, startIndex, endIndex, byScenario, fineByScenario, samples: [] };
}

function fineAccumulator(
  period: PeriodAccumulator,
  scenario: ScoreScenario,
  key: string,
): BucketAccumulator {
  const map = period.fineByScenario.get(scenario)!;
  let accumulator = map.get(key);
  if (!accumulator) {
    accumulator = createAccumulator();
    map.set(key, accumulator);
  }
  return accumulator;
}

function summarizeBucket(scoreBandName: string, accumulator: BucketAccumulator): BacktestBucket {
  const trades = accumulator.trades.slice().sort((a, b) => a.exitIndex - b.exitIndex);
  const count = trades.length;
  const grossValues = trades.map((trade) => trade.grossR);
  const netAt005 = grossValues.map((grossR) => grossR - BASE_FRICTION_R);
  const wins = netAt005.filter((netR) => netR > 0).length;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const netR of netAt005) {
    equity += netR;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const average = (values: number[]) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
    : null;

  return {
    scoreBand: scoreBandName,
    signals: accumulator.signals,
    ordersPlaced: accumulator.ordersPlaced,
    unfilledOrders: accumulator.unfilledOrders,
    trades: count,
    wins,
    winRate: count ? Number((wins / count * 100).toFixed(1)) : null,
    averageGrossR: average(grossValues),
    expectancyNetRAt0Cost: average(grossValues),
    expectancyNetRAt005Cost: average(netAt005),
    expectancyNetRAt010Cost: average(grossValues.map((grossR) => grossR - 0.1)),
    maxDrawdownRAt005Cost: count ? Number(maxDrawdown.toFixed(3)) : null,
  };
}

function makePeriodResult(
  period: PeriodAccumulator,
  bars: Candle[],
  scenario: ScoreScenario,
): BacktestPeriod {
  const first = bars[period.startIndex];
  const last = bars[Math.max(period.startIndex, period.endIndex - 1)];
  const fineMap = period.fineByScenario.get(scenario) ?? new Map<string, BucketAccumulator>();
  const fineKeys = Array.from(fineMap.keys()).sort((a, b) => fineBucketOrder(a) - fineBucketOrder(b));
  const fineBuckets = fineKeys.map((key) => summarizeBucket(key, fineMap.get(key)!));

  return {
    name: period.name,
    from: first?.datetime ?? "",
    to: last?.datetime ?? "",
    buckets: SCORE_BANDS.map((band) => summarizeBucket(
      band.key,
      period.byScenario.get(scenario)?.get(band.key) ?? createAccumulator(),
    )),
    fineBuckets,
    scoreHistogram: fineBuckets.map((bucket) => ({
      scoreBucket: bucket.scoreBand,
      signals: bucket.signals,
    })),
  };
}

export function simulateLimitOrder(
  bars: Candle[],
  signalIndex: number,
  segmentEnd: number,
  setup: ReturnType<typeof buildTradeSetup>,
  maxPendingBars: number,
  maxHoldBars: number,
): OrderOutcome {
  const pendingEnd = Math.min(signalIndex + maxPendingBars, segmentEnd - 1);
  let entryIndex = -1;
  for (let index = signalIndex + 1; index <= pendingEnd; index++) {
    const candle = bars[index];
    if (candle.low <= setup.entryPrice && candle.high >= setup.entryPrice) {
      entryIndex = index;
      break;
    }
  }

  if (entryIndex < 0) {
    return { filled: false, nextAvailableIndex: pendingEnd + 1 };
  }

  const risk = Math.abs(setup.entryPrice - setup.stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return { filled: false, nextAvailableIndex: entryIndex + 1 };
  }

  const sign = setup.direction === "BUY" ? 1 : -1;
  const target = setup.tp2;
  const targetR = sign * (target - setup.entryPrice) / risk;
  const exitEnd = Math.min(entryIndex + maxHoldBars, segmentEnd - 1);
  for (let index = entryIndex; index <= exitEnd; index++) {
    const candle = bars[index];
    const stopHit = setup.direction === "BUY"
      ? candle.low <= setup.stopLoss
      : candle.high >= setup.stopLoss;
    const targetHit = setup.direction === "BUY"
      ? candle.high >= target
      : candle.low <= target;

    // OHLC cannot reveal which level traded first. Use the adverse outcome.
    if (stopHit) {
      return {
        filled: true,
        nextAvailableIndex: index + 1,
        trade: { signalIndex, exitIndex: index, grossR: -1 },
      };
    }
    if (targetHit) {
      return {
        filled: true,
        nextAvailableIndex: index + 1,
        trade: { signalIndex, exitIndex: index, grossR: targetR },
      };
    }
  }

  const close = bars[exitEnd].close;
  const grossR = Math.max(-1, Math.min(targetR, sign * (close - setup.entryPrice) / risk));
  return {
    filled: true,
    nextAvailableIndex: exitEnd + 1,
    trade: { signalIndex, exitIndex: exitEnd, grossR },
  };
}

/**
 * Replay the current M15 setup logic with closed candles and only historical
 * H1 candles whose close time is no later than the M15 signal candle close.
 * No score threshold or indicator state is used to suppress candidate signals.
 */
export function runConfidenceBacktest(
  pair: string,
  m15Input: Candle[],
  h1Input: Candle[],
  options: { maxPendingBars?: number; maxHoldBars?: number; includeSamples?: boolean } = {},
): ConfidenceBacktestReport {
  const m15 = getClosedCandles(m15Input);
  const h1 = getClosedCandles(h1Input);
  const maxPendingBars = options.maxPendingBars ?? DEFAULT_PENDING_BARS;
  const maxHoldBars = options.maxHoldBars ?? DEFAULT_HOLD_BARS;
  const includeSamples = options.includeSamples ?? false;
  if (m15.length < LIVE_WINDOW_CANDLES + maxPendingBars + maxHoldBars + 2) {
    throw new Error(`Not enough closed M15 candles for replay: ${m15.length}`);
  }
  if (h1.length < LIVE_WINDOW_CANDLES) {
    throw new Error(`Not enough closed H1 candles for replay: ${h1.length}`);
  }

  const splitIndex = Math.floor(m15.length * 0.7);
  const warmupIndex = LIVE_WINDOW_CANDLES - 1;
  const periods = [
    initPeriod("calibration", warmupIndex, splitIndex),
    initPeriod("out-of-sample", splitIndex, m15.length),
  ];
  const newsRisks = new Map(SCORE_SCENARIOS.map((scenario) => [scenario.key, (signalTime: number) => ({
    status: scenario.status,
    riskScore: scenario.riskScore,
    headline: "Historical news archive is unavailable for this replay.",
    source: "Backtest assumption",
    fetchedAt: new Date(signalTime).toISOString(),
    windowMinutes: 180,
    items: [],
    upcomingEvents: [],
  })]));

  for (const period of periods) {
    let nextAvailableIndex = period.startIndex;
    let h1Index = 0;
    const lastSignalIndex = period.endIndex - maxPendingBars - maxHoldBars - 1;

    for (let index = period.startIndex; index <= lastSignalIndex; index++) {
      const signalBar = m15[index];
      const signalCloseTime = candleTimeMs(signalBar) + 15 * 60_000;
      while (
        h1Index < h1.length &&
        candleTimeMs(h1[h1Index]) + 60 * 60_000 <= signalCloseTime
      ) {
        h1Index++;
      }
      const h1History = h1.slice(Math.max(0, h1Index - LIVE_WINDOW_CANDLES), h1Index);
      if (h1History.length < LIVE_WINDOW_CANDLES) continue;

      const m15History = m15.slice(Math.max(0, index + 1 - LIVE_WINDOW_CANDLES), index + 1);
      if (m15History.length < LIVE_WINDOW_CANDLES) continue;

      const h1Trend = analyzeTrendFromCandles(h1History);
      const m15Trend = analyzeTrendFromCandles(m15History);
      const setup = buildTradeSetup(
        pair,
        h1Trend.direction,
        m15History,
        h1Trend.marketState,
        m15Trend.marketState,
        m15Trend.direction,
      );
      const confidences = new Map<ScoreScenario, ReturnType<typeof calculateConfidence>>();
      for (const scenario of SCORE_SCENARIOS) {
        const confidence = calculateConfidence(
          pair,
          h1Trend,
          m15Trend,
          m15History,
          setup.riskRewardRatio,
          newsRisks.get(scenario.key)!(signalCloseTime),
        );
        confidences.set(scenario.key, confidence);
        const bucket = period.byScenario.get(scenario.key)!.get(scoreBand(confidence.score))!;
        bucket.signals++;
        fineAccumulator(period, scenario.key, scoreBucket5(confidence.score)).signals++;
      }

      // The simulation holds at most one open/pending order per pair. All score
      // observations are still counted; this only models finite trading capital.
      const outcome = index >= nextAvailableIndex
        ? simulateLimitOrder(m15, index, period.endIndex, setup, maxPendingBars, maxHoldBars)
        : undefined;
      if (outcome) nextAvailableIndex = outcome.nextAvailableIndex;

      for (const scenario of SCORE_SCENARIOS) {
        const confidence = confidences.get(scenario.key)!;
        const score = confidence.score;
        const band = scoreBand(score);
        const fine = fineAccumulator(period, scenario.key, scoreBucket5(score));
        const bucket = period.byScenario.get(scenario.key)!.get(band)!;

        if (outcome) {
          bucket.ordersPlaced++;
          fine.ordersPlaced++;
          if (!outcome.filled) {
            bucket.unfilledOrders++;
            fine.unfilledOrders++;
          } else if (outcome.trade) {
            bucket.trades.push(outcome.trade);
            fine.trades.push(outcome.trade);
          }
        }

        if (includeSamples) {
          const trade = outcome?.trade;
          const sampleOutcome: BacktestSampleOutcome = !outcome
            ? "not-simulated"
            : !outcome.filled
              ? "unfilled"
              : trade && trade.grossR > BASE_FRICTION_R
                ? "win"
                : "loss";
          period.samples.push({
            pair,
            scoreScenario: scenario.key,
            period: period.name,
            signalAt: signalBar.datetime,
            score,
            scoreBand: band,
            scoreBucket5: scoreBucket5(score),
            direction: h1Trend.direction,
            h1Direction: h1Trend.direction,
            m15Direction: m15Trend.direction,
            h1MarketState: h1Trend.marketState,
            m15MarketState: m15Trend.marketState,
            h1Structure: h1Trend.structure,
            m15Structure: m15Trend.structure,
            timeframeAligned: confidence.timeframeAligned,
            riskRewardRatio: setup.riskRewardRatio,
            entryPrice: setup.entryPrice,
            stopLoss: setup.stopLoss,
            takeProfit1: setup.tp1,
            takeProfit2: setup.tp2,
            takeProfit3: setup.tp3,
            orderSimulated: Boolean(outcome),
            filled: outcome?.filled ?? false,
            outcome: sampleOutcome,
            grossR: trade ? Number(trade.grossR.toFixed(4)) : null,
            netRAt005Cost: trade ? Number((trade.grossR - BASE_FRICTION_R).toFixed(4)) : null,
            exitAt: trade ? m15[trade.exitIndex]?.datetime ?? null : null,
            checklist: confidence.checklist,
          });
        }
      }
    }
  }

  const splitAt = m15[splitIndex].datetime;
  return {
    pair,
    entryTimeframe: "M15",
    confirmationTimeframe: "H1",
    candlesM15: m15.length,
    candlesH1: h1.length,
    m15From: m15[0].datetime,
    m15To: m15.at(-1)!.datetime,
    splitAt,
    scenarios: SCORE_SCENARIOS.map((scenario) => ({
      scoreScenario: scenario.key,
      periods: periods.map((period) => makePeriodResult(period, m15, scenario.key)),
    })),
    assumptions: [
      "Entry signals are evaluated after each closed M15 candle; H1 candles are admitted only after their modeled close time.",
      "Historical news is unavailable. The primary news-neutral score assumes riskScore 0; a parallel scenario assumes UNAVAILABLE with riskScore 60.",
      "Signals are counted at every eligible candle. Only one pending/open order per pair is simulated at a time, without score-based rejection.",
      "Limit entry is the planned entry-zone midpoint, active for the next 8 M15 bars; unfilled orders expire.",
      "After fill, TP2 is the target and SL the stop; maximum hold is 32 M15 bars. Same-bar stop/target ambiguity is resolved as a stop first.",
      "Spread and slippage are unavailable. Expectancy is shown at 0R, 0.05R, and 0.10R round-trip friction per trade.",
      "Drawdown is sequential closed-trade drawdown in R for this one-position simulation, not a broker-equity forecast.",
      "The first 70% of M15 history is the calibration period; the final 30% is a chronological holdout. No weights or thresholds were fitted on the holdout.",
      "The replay uses the latest provider history returned for each request; actual history length can be shorter than requested and this is not a tick-level execution simulation.",
      "The final 40 M15 bars of each split are excluded as signal times so pending entries and the maximum holding window finish inside their own period.",
      "Provider timestamps have no explicit timezone in the candle rows; calculations assume H1 and M15 use the same provider timezone and reports retain the original timestamp strings.",
    ],
    ...(includeSamples
      ? { samples: periods.flatMap((period) => period.samples) }
      : {}),
  };
}
