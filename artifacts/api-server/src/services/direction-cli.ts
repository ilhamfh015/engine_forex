/**
 * direction-cli
 *
 * Builds the directional dataset from closed candles, fits a small logistic
 * model on the calibration split, checks it once on the chronological holdout,
 * and writes the fitted constants into DirectionModelCoefficients.ts.
 *
 * No database is used. Run with:
 *   pnpm --filter @workspace/api-server run backtest:direction
 *
 * Label definition (evaluation only — it never sets the trader's TP or SL):
 *   within the next HORIZON_BARS closed M15 bars, does price touch +BARRIER_ATR
 *   before -BARRIER_ATR? If neither barrier is touched, the sign of the horizon
 *   return decides. A bar that touches both is resolved by that bar's close.
 *
 * Overlap: features are sampled every 4 bars (1 hour) but a label spans the whole
 * horizon, so neighbouring rows share most of their future path. Rows are useful
 * for fitting, but they inflate apparent significance. All reported accuracy
 * therefore comes from a non-overlapping subset (every `OVERLAP_EVERY`-th row per
 * pair), and the cutoff rule is applied to that subset only.
 *
 * Selection: λ and the strength cutoffs come from an inner time split of the
 * calibration block; the chronological holdout is read once, at the end, for the
 * finally chosen variant. `DIRECTION_HOLDOUT=off` skips that read entirely.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_PAIRS, analyzeTrendFromCandles, type TrendData } from "./MarketStructureService.js";
import { getCandles, getClosedCandles, calcATR } from "./TwelveDataService.js";
import type { Candle } from "./TwelveDataService.js";
import {
  DIRECTION_FEATURE_NAMES,
  extractDirectionFeatures,
  sigmoid,
  type DirectionFeatureVector,
} from "./DirectionModelService.js";

// Defaults match the shipped model so a plain `backtest:direction` reproduces
// the committed artifact; override them only when comparing variants.
const HORIZON_BARS = Number(process.env.DIRECTION_HORIZON ?? 8);
const BARRIER_ATR = Number(process.env.DIRECTION_BARRIER ?? 0.5);
const STRIDE_BARS = 4;
const OVERLAP_EVERY = Math.max(1, Math.round(HORIZON_BARS / STRIDE_BARS));
const WINDOW_CANDLES = 99;
const REQUESTED_CANDLES = Number(process.env.DIRECTION_CANDLES ?? 5000);
// H1 only needs to cover the M15 window plus warm-up; asking for 5,000 H1 bars
// makes the provider request both larger and more timeout-prone.
const H1_CANDLES = Math.ceil(REQUESTED_CANDLES / 4) + 200;
const LAMBDA_GRID = [0.1, 0.5, 2, 8];
const CALIBRATION_SHARE = 0.7;

const ALL_FEATURES: readonly string[] = DIRECTION_FEATURE_NAMES;
// The shipped model uses the four M15 inputs; the H1 block was dropped after it
// failed to generalise. Override with a comma-separated DIRECTION_FEATURES list.
const DEFAULT_FEATURES = ["m15Dmi", "m15Rsi", "m15DistEma", "m15Momentum"];
const USED_FEATURES: string[] = process.env.DIRECTION_FEATURES
  ? process.env.DIRECTION_FEATURES.split(",").map((name) => name.trim()).filter(Boolean)
  : [...DEFAULT_FEATURES];
for (const name of USED_FEATURES) {
  if (!ALL_FEATURES.includes(name)) {
    process.stderr.write(`Unknown feature in DIRECTION_FEATURES: ${name}\n`);
    process.exit(1);
  }
}
// Feature extraction is the expensive part of this script. Cache candles and
// rows so alternative horizons and barriers can be compared without refetching.
const REBUILD = process.env.DIRECTION_REBUILD === "1";
const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backtest-results");
const CANDLE_CACHE = path.join(CACHE_DIR, "direction-candles-cache.json");
const ROW_CACHE = path.join(CACHE_DIR, "direction-rows-cache.json");

interface CachedCandles { [pair: string]: { m15: Candle[]; h1: Candle[] } }

interface Row {
  pair: string;
  time: number;
  index: number;
  label: number;
  ruleUp: number;
  features: DirectionFeatureVector;
  /** True when this row's label does not overlap the previous kept row. */
  independent: boolean;
}

function utcMs(candle: Candle): number {
  const raw = candle.datetime.trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);
  if (!Number.isFinite(ms)) throw new Error(`Invalid candle timestamp: ${candle.datetime}`);
  return ms;
}

/** +BARRIER_ATR before -BARRIER_ATR inside the horizon, else the sign of the horizon return. */
function labelForward(m15: Candle[], index: number, atr: number): number | null {
  const entry = m15[index].close;
  const up = entry + BARRIER_ATR * atr;
  const down = entry - BARRIER_ATR * atr;
  const end = Math.min(index + HORIZON_BARS, m15.length - 1);
  for (let j = index + 1; j <= end; j++) {
    const hitUp = m15[j].high >= up;
    const hitDown = m15[j].low <= down;
    if (hitUp && hitDown) return m15[j].close >= entry ? 1 : 0;
    if (hitUp) return 1;
    if (hitDown) return 0;
  }
  const ret = m15[end].close - entry;
  if (ret === 0) return null;
  return ret > 0 ? 1 : 0;
}

function standardize(rows: DirectionFeatureVector[]): { means: number[]; stds: number[] } {
  const d = rows[0]?.length ?? 0;
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let sum = 0;
    for (const row of rows) sum += row[j];
    const mean = sum / rows.length;
    let variance = 0;
    for (const row of rows) variance += (row[j] - mean) ** 2;
    means[j] = mean;
    stds[j] = Math.sqrt(variance / rows.length) || 1;
  }
  return { means, stds };
}

function transform(rows: DirectionFeatureVector[], means: number[], stds: number[]): DirectionFeatureVector[] {
  return rows.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
}

function fitLogistic(X: DirectionFeatureVector[], y: number[], lambda: number): { weights: number[]; intercept: number } {
  const n = X.length;
  const d = X[0].length;
  const weights = new Array<number>(d).fill(0);
  let intercept = 0;
  const mW = new Array<number>(d).fill(0);
  const vW = new Array<number>(d).fill(0);
  let mB = 0;
  let vB = 0;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  const lr = 0.05;
  const iters = 1600;

  for (let it = 1; it <= iters; it++) {
    const gW = new Array<number>(d).fill(0);
    let gB = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = intercept;
      for (let j = 0; j < d; j++) z += weights[j] * xi[j];
      const error = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gW[j] += error * xi[j];
      gB += error;
    }
    for (let j = 0; j < d; j++) gW[j] = gW[j] / n + lambda * weights[j];
    gB /= n;
    const bc1 = 1 - Math.pow(beta1, it);
    const bc2 = 1 - Math.pow(beta2, it);
    for (let j = 0; j < d; j++) {
      mW[j] = beta1 * mW[j] + (1 - beta1) * gW[j];
      vW[j] = beta2 * vW[j] + (1 - beta2) * gW[j] * gW[j];
      weights[j] -= (lr * (mW[j] / bc1)) / (Math.sqrt(vW[j] / bc2) + eps);
    }
    mB = beta1 * mB + (1 - beta1) * gB;
    vB = beta2 * vB + (1 - beta2) * gB * gB;
    intercept -= (lr * (mB / bc1)) / (Math.sqrt(vB / bc2) + eps);
  }
  return { weights, intercept };
}

function predictedUp(X: DirectionFeatureVector[], weights: number[], intercept: number): number[] {
  return X.map((row) => {
    let z = intercept;
    for (let j = 0; j < row.length; j++) z += weights[j] * row[j];
    return sigmoid(z);
  });
}

function accuracy(predictions: number[], y: number[]): number {
  let correct = 0;
  for (let i = 0; i < y.length; i++) {
    if ((predictions[i] >= 0.5 ? 1 : 0) === y[i]) correct++;
  }
  return correct / y.length;
}

function brier(predictions: number[], y: number[]): number {
  let sum = 0;
  for (let i = 0; i < y.length; i++) sum += (predictions[i] - y[i]) ** 2;
  return sum / y.length;
}

function logLoss(predictions: number[], y: number[]): number {
  let sum = 0;
  for (let i = 0; i < y.length; i++) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, predictions[i]));
    sum += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
  }
  return sum / y.length;
}

/** Rank-based AUC with ties handled as 0.5. */
function auc(predictions: number[], y: number[]): number {
  const pairs = predictions.map((p, i) => ({ p, y: y[i] })).sort((a, b) => a.p - b.p);
  let rankSumPos = 0;
  let positives = 0;
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].p === pairs[i].p) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      if (pairs[k].y === 1) {
        rankSumPos += avgRank;
        positives++;
      }
    }
    i = j + 1;
  }
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  return (rankSumPos - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function scoreOf(p: number): number {
  return Math.round(100 * Math.max(p, 1 - p));
}

function summarize(name: string, predictions: number[], y: number[]): void {
  const base = y.reduce((a, b) => a + b, 0) / y.length;
  const majority = Math.max(base, 1 - base);
  process.stdout.write(
    `${name.padEnd(26)} n=${String(y.length).padStart(5)}  baseUp=${base.toFixed(3)}  ` +
    `acc=${accuracy(predictions, y).toFixed(3)}  majority=${majority.toFixed(3)}  ` +
    `auc=${auc(predictions, y).toFixed(3)}  brier=${brier(predictions, y).toFixed(4)}  ` +
    `logloss=${logLoss(predictions, y).toFixed(4)}\n`,
  );
}

function aboveCutoff(predictions: number[], y: number[], cutoff: number): { n: number; acc: number } {
  const idx = predictions.map((p, i) => (scoreOf(p) >= cutoff ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return { n: 0, acc: 0 };
  return {
    n: idx.length,
    acc: idx.filter((i) => ((predictions[i] >= 0.5 ? 1 : 0) === y[i])).length / idx.length,
  };
}

interface Bucket { low: number; high: number; n: number; acc: number }
function bucketsFor(predictions: number[], y: number[]): Bucket[] {
  const defs = [[50, 54], [55, 59], [60, 64], [65, 69], [70, 100]] as const;
  return defs.map(([low, high]) => {
    const idx = predictions.map((p, i) => (scoreOf(p) >= low && scoreOf(p) <= high ? i : -1)).filter((i) => i >= 0);
    const acc = idx.length
      ? idx.filter((i) => ((predictions[i] >= 0.5 ? 1 : 0) === y[i])).length / idx.length
      : 0;
    return { low, high, n: idx.length, acc };
  });
}

// ─── Build the dataset ────────────────────────────────────────────────────────

async function fetchSeries(pair: string, timeframe: "H1" | "M15", count: number): Promise<Candle[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await getCandles(pair, timeframe, count);
    } catch (error) {
      lastError = error;
      process.stdout.write(`  ${pair} ${timeframe} attempt ${attempt + 1} failed; retrying...\n`);
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

const rows: Row[] = [];

async function loadCandles(): Promise<CachedCandles> {
  if (!REBUILD) {
    try {
      return JSON.parse(await readFile(CANDLE_CACHE, "utf8")) as CachedCandles;
    } catch {
      // No usable cache; fall through to a live fetch.
    }
  }
  const fetched: CachedCandles = {};
  for (const pair of SUPPORTED_PAIRS) {
    process.stdout.write(`Fetching ${pair}...\n`);
    const [h1Raw, m15Raw] = await Promise.all([
      fetchSeries(pair, "H1", H1_CANDLES),
      fetchSeries(pair, "M15", REQUESTED_CANDLES),
    ]);
    fetched[pair] = { h1: getClosedCandles(h1Raw), m15: getClosedCandles(m15Raw) };
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CANDLE_CACHE, JSON.stringify(fetched), "utf8");
  return fetched;
}

interface BaseRow {
  pair: string;
  time: number;
  index: number;
  ruleUp: number;
  features: DirectionFeatureVector;
}

async function buildBaseRows(candlesByPair: CachedCandles): Promise<BaseRow[]> {
  if (!REBUILD) {
    try {
      return JSON.parse(await readFile(ROW_CACHE, "utf8")) as BaseRow[];
    } catch {
      // Recompute below.
    }
  }

  const built: BaseRow[] = [];
  for (const pair of SUPPORTED_PAIRS) {
    const { h1, m15 } = candlesByPair[pair];
    let h1Index = 0;
    let cachedIndex = -1;
    let cachedTrend: TrendData | null = null;
    let kept = 0;

    for (let index = WINDOW_CANDLES - 1; index <= m15.length - 1; index += STRIDE_BARS) {
      const signalCloseTime = utcMs(m15[index]) + 15 * 60_000;
      while (h1Index < h1.length && utcMs(h1[h1Index]) + 60 * 60_000 <= signalCloseTime) h1Index++;
      if (h1Index < WINDOW_CANDLES) continue;

      const h1History = h1.slice(h1Index - WINDOW_CANDLES, h1Index);
      const m15History = m15.slice(index + 1 - WINDOW_CANDLES, index + 1);
      if (h1History.length < WINDOW_CANDLES || m15History.length < WINDOW_CANDLES) continue;

      if (cachedIndex !== h1Index) {
        cachedTrend = analyzeTrendFromCandles(h1History);
        cachedIndex = h1Index;
      }
      const h1Trend = cachedTrend!;
      const m15Trend = analyzeTrendFromCandles(m15History);

      built.push({
        pair,
        time: signalCloseTime,
        index,
        ruleUp: h1Trend.direction === "BUY" ? 1 : 0,
        features: extractDirectionFeatures(h1History, m15History, h1Trend, m15Trend),
      });
      kept++;
    }
    process.stdout.write(`  ${pair}: ${kept} base rows\n`);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(ROW_CACHE, JSON.stringify(built), "utf8");
  return built;
}

const candlesByPair = await loadCandles();
const baseRows = await buildBaseRows(candlesByPair);

// Labels depend on the horizon/barrier being tested, so they are recomputed
// from the cached candles each run instead of being stored with the features.
for (const base of baseRows) {
  const m15 = candlesByPair[base.pair].m15;
  const end = base.index + HORIZON_BARS;
  if (end > m15.length - 1) continue;
  const window = m15.slice(base.index + 1 - WINDOW_CANDLES, base.index + 1);
  const atr = calcATR(window, 14);
  const label = labelForward(m15, base.index, atr);
  if (label === null) continue;
  rows.push({ ...base, label, independent: false });
}

// Non-overlapping flag: keep every Nth row inside each pair, in time order.
for (const pair of SUPPORTED_PAIRS) {
  const pairRows = rows.filter((row) => row.pair === pair).sort((a, b) => a.time - b.time);
  pairRows.forEach((row, i) => {
    row.independent = i % OVERLAP_EVERY === 0;
  });
}

if (rows.length < 500) {
  process.stderr.write(`Only ${rows.length} rows; need at least 500 to fit anything.\n`);
  process.exit(1);
}

// Chronological split across all pairs so the holdout is a later period.
rows.sort((a, b) => a.time - b.time);
const splitTime = rows[Math.floor(rows.length * CALIBRATION_SHARE)].time;
const calibration = rows.filter((row) => row.time < splitTime);
const holdout = rows.filter((row) => row.time >= splitTime);
const calIndependent = calibration.filter((row) => row.independent);
const oosIndependent = holdout.filter((row) => row.independent);

const featureIndexByName = new Map<string, number>(ALL_FEATURES.map((name, index) => [name, index]));
function project(vector: DirectionFeatureVector): DirectionFeatureVector {
  return USED_FEATURES.map((name) => vector[featureIndexByName.get(name)!]);
}

const calX = calibration.map((row) => project(row.features));
const calY = calibration.map((row) => row.label);
const oosX = holdout.map((row) => project(row.features));
const oosY = holdout.map((row) => row.label);

process.stdout.write(
  `\nrows=${rows.length} (cal ${calibration.length} / oos ${holdout.length})  ` +
  `independent rows: cal ${calIndependent.length} / oos ${oosIndependent.length}\n` +
  `horizon=${HORIZON_BARS} bars (${HORIZON_BARS / 4}h)  barrier=${BARRIER_ATR} ATR  feature stride=${STRIDE_BARS}\n`,
);
process.stdout.write(
  `split at ${new Date(splitTime).toISOString()}  cal ${new Date(calibration[0].time).toISOString()} → ` +
  `${new Date(calibration[calibration.length - 1].time).toISOString()}\n`,
);

// ─── Fit with a nested time split ────────────────────────────────────────────
//
// Choosing λ by training log-loss would always pick the weakest regularisation,
// and reporting accuracy on the rows a model was fitted on would always favour
// the most complex model. So the calibration block is itself split in time: the
// earlier part fits, the later part selects. The final model is then refitted on
// the whole calibration block, and the holdout is read once.

const INNER_VALIDATION_SHARE = Number(process.env.DIRECTION_INNER_SHARE ?? 0.25);
const innerCut = Math.floor(calibration.length * (1 - INNER_VALIDATION_SHARE));
const innerTrain = calibration.slice(0, innerCut);
const innerVal = calibration.slice(innerCut);

const trainX = innerTrain.map((row) => project(row.features));
const trainY = innerTrain.map((row) => row.label);
const valX = innerVal.map((row) => project(row.features));
const valY = innerVal.map((row) => row.label);

const trainStats = standardize(trainX);
const trainZ = transform(trainX, trainStats.means, trainStats.stds);
const valZ = transform(valX, trainStats.means, trainStats.stds);

let selectedLambda = LAMBDA_GRID[0];
let bestValLoss = Number.POSITIVE_INFINITY;
for (const lambda of LAMBDA_GRID) {
  const { weights, intercept } = fitLogistic(trainZ, trainY, lambda);
  const valPred = predictedUp(valZ, weights, intercept);
  const loss = logLoss(valPred, valY);
  const valAuc = auc(valPred, valY);
  process.stdout.write(
    `  lambda=${String(lambda).padStart(4)}  inner-val logloss=${loss.toFixed(4)}  auc=${valAuc.toFixed(3)}\n`,
  );
  if (loss < bestValLoss) {
    bestValLoss = loss;
    selectedLambda = lambda;
  }
}
process.stdout.write(`selected lambda=${selectedLambda} (by inner-validation log-loss)\n`);

// Inner-validation predictions, used for the cutoff rule.
const selModel = fitLogistic(trainZ, trainY, selectedLambda);
const valPredFinal = predictedUp(valZ, selModel.weights, selModel.intercept);
const valIndepIdx = innerVal.map((row, i) => (row.independent ? i : -1)).filter((i) => i >= 0);
const valIndepPred = valIndepIdx.map((i) => valPredFinal[i]);
const valIndepY = valIndepIdx.map((i) => valY[i]);
const baseUpVal = valIndepY.reduce((a, b) => a + b, 0) / valIndepY.length;

process.stdout.write("\n── Inner validation (selection split, all rows) ──────────────────────\n");
summarize("model, inner-val", valPredFinal, valY);
summarize("rule, inner-val", innerVal.map((row) => row.ruleUp), valY);
process.stdout.write("\n── Inner validation (non-overlapping rows) ───────────────────────────\n");
summarize("model, inner-val", valIndepPred, valIndepY);
summarize("rule, inner-val", valIndepIdx.map((i) => innerVal[i].ruleUp), valIndepY);

// Final fit on the whole calibration block, using the selected λ.
const { means, stds } = standardize(calX);
const calZ = transform(calX, means, stds);
const oosZ = transform(oosX, means, stds);
const final = fitLogistic(calZ, calY, selectedLambda);
const best = { lambda: selectedLambda, weights: final.weights, intercept: final.intercept };

const calPred = predictedUp(calZ, best.weights, best.intercept);
const oosPred = predictedUp(oosZ, best.weights, best.intercept);

const calPredByTime = new Map(calibration.map((row, i) => [row, calPred[i]]));
const oosPredByTime = new Map(holdout.map((row, i) => [row, oosPred[i]]));
const calIndepPred = calIndependent.map((row) => calPredByTime.get(row)!);
const calIndepY = calIndependent.map((row) => row.label);
const oosIndepPred = oosIndependent.map((row) => oosPredByTime.get(row)!);
const oosIndepY = oosIndependent.map((row) => row.label);

process.stdout.write("\n── Accuracy (fitting rows, reference only — not evidence) ─────────────\n");
summarize("rule, all cal", calibration.map((row) => row.ruleUp), calY);
summarize("model, all cal", calPred, calY);
summarize("model, all oos", oosPred, oosY);

process.stdout.write("\n── Accuracy (non-overlapping rows) ───────────────────────────────────\n");
summarize("rule, cal", calIndependent.map((row) => row.ruleUp), calIndepY);
summarize("model, cal", calIndepPred, calIndepY);
summarize("rule, oos", oosIndependent.map((row) => row.ruleUp), oosIndepY);
summarize("model, oos", oosIndepPred, oosIndepY);

const baseUpCal = calIndepY.reduce((a, b) => a + b, 0) / calIndepY.length;
process.stdout.write("\n── Per instrument (independent holdout, model) ────────────────────────\n");
for (const pair of SUPPORTED_PAIRS) {
  const idx = oosIndependent.map((row, i) => (row.pair === pair ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 20) continue;
  const p = idx.map((i) => oosIndepPred[i]);
  const y = idx.map((i) => oosIndepY[i]);
  process.stdout.write(
    `  ${pair.padEnd(7)} n=${String(idx.length).padStart(4)}  acc=${accuracy(p, y).toFixed(3)}  auc=${auc(p, y).toFixed(3)}\n`,
  );
}

// ─── Score buckets (inner validation; cutoffs are chosen here, never on holdout)

process.stdout.write("\n── Score buckets (inner validation, non-overlapping) ──────────────────\n");
for (const bucket of bucketsFor(valIndepPred, valIndepY)) {
  process.stdout.write(
    `  ${String(bucket.low).padStart(3)}-${String(bucket.high).padEnd(3)}  n=${String(bucket.n).padStart(4)}  acc=${bucket.acc.toFixed(3)}\n`,
  );
}

// Pre-declared adoption rule on the inner-validation split:
//   medium = 55 if the 55+ bucket beats the base rate by 2 points with n >= 30
//   strong = first of 60/65/70 that beats the base rate by 5 points with n >= 30
// If nothing qualifies, the label is disabled (101) instead of inventing an edge.
const MIN_CUTOFF_ROWS = 30;
const medium = aboveCutoff(valIndepPred, valIndepY, 55);
const mediumCutoff = medium.n >= MIN_CUTOFF_ROWS && medium.acc >= baseUpVal + 0.02 ? 55 : 101;

let strongCutoff = 101;
for (const cutoff of [60, 65, 70]) {
  const stats = aboveCutoff(valIndepPred, valIndepY, cutoff);
  if (stats.n >= MIN_CUTOFF_ROWS && stats.acc >= baseUpVal + 0.05) {
    strongCutoff = cutoff;
    break;
  }
}

process.stdout.write(`\nchosen cutoffs: medium=${mediumCutoff} strong=${strongCutoff}\n`);
if (mediumCutoff === 101) {
  process.stdout.write("  WARNING: no bucket beat the base rate on inner validation.\n");
}

// A variant search must not read the holdout. Run with DIRECTION_HOLDOUT=off
// while comparing horizons, barriers and feature subsets; only the finally
// chosen variant is evaluated on the holdout, once.
const READ_HOLDOUT = process.env.DIRECTION_HOLDOUT !== "off";

process.stdout.write(
  `\nVARIANT horizon=${HORIZON_BARS} barrier=${BARRIER_ATR} features=${USED_FEATURES.length} lambda=${selectedLambda} ` +
  `valAuc=${auc(valIndepPred, valIndepY).toFixed(3)} valAcc=${accuracy(valIndepPred, valIndepY).toFixed(3)} ` +
  `majority=${Math.max(baseUpVal, 1 - baseUpVal).toFixed(3)} n=${valIndepY.length}\n`,
);

if (READ_HOLDOUT) {
  process.stdout.write("\n── Holdout once (independent rows) ────────────────────────────────────\n");
  for (const cutoff of [55, 60, 65, 70]) {
    const stats = aboveCutoff(oosIndepPred, oosIndepY, cutoff);
    process.stdout.write(
      `  score >= ${cutoff}: n=${String(stats.n).padStart(3)}  acc=${stats.acc.toFixed(3)}\n`,
    );
  }
  process.stdout.write(`  base up (holdout): ${(oosIndepY.reduce((a, b) => a + b, 0) / oosIndepY.length).toFixed(3)}\n`);
} else {
  process.stdout.write("  holdout skipped (DIRECTION_HOLDOUT=off); coefficients not written.\n");
}

// ─── Weights ────────────────────────────────────────────────────────────────

process.stdout.write("\n── Weights (standardised inputs) ──────────────────────────────────────\n");
USED_FEATURES.forEach((name, index) => {
  process.stdout.write(`  ${name.padEnd(14)} ${best!.weights[index].toFixed(4).padStart(8)}\n`);
});
process.stdout.write(`  ${"intercept".padEnd(14)} ${best.intercept.toFixed(4).padStart(8)}\n`);

// ─── Write the compiled coefficients ────────────────────────────────────────

const strongHoldout = aboveCutoff(oosIndepPred, oosIndepY, strongCutoff === 101 ? 55 : strongCutoff);
const holdoutAcc = accuracy(oosIndepPred, oosIndepY);
const holdoutAuc = auc(oosIndepPred, oosIndepY);
// The holdout was already inspected for earlier candidate models, so it is no
// longer a clean confirmation set. Say so where the numbers are displayed.
const caveat =
  `Holdout hanya ${oosIndepY.length} sampel dan sudah pernah dilihat saat membandingkan varian lain, ` +
  `jadi angka ${(holdoutAcc * 100).toFixed(0)}% (AUC ${holdoutAuc.toFixed(2)}) masih indikatif, ` +
  `belum konfirmasi independen. Riwayat data yang tersedia pendek, sehingga model yang lebih besar ` +
  `akan overfit; versi ini sengaja memakai sedikit input.`;
const trainedThrough = new Date(calibration[calibration.length - 1].time).toISOString();
const calibrationBuckets = bucketsFor(valIndepPred, valIndepY)
  .filter((bucket) => bucket.n > 0)
  .map((bucket) => ({
    low: bucket.low,
    high: bucket.high,
    samples: bucket.n,
    accuracy: Number(bucket.acc.toFixed(3)),
  }));

const source = `/**
 * AUTO-GENERATED by src/services/direction-cli.ts.
 *
 * Fitted on the calibration split only; the chronological holdout was checked
 * once. Re-run \`pnpm --filter @workspace/api-server run backtest:direction\`
 * to regenerate after new data arrives, and do not hand-edit.
 *
 * Fit details: horizon ${HORIZON_BARS} M15 bars, barrier ${BARRIER_ATR} ATR,
 * feature stride ${STRIDE_BARS}, lambda ${best.lambda}, ${calibration.length} calibration rows.
 * Lambda and the strength cutoffs were chosen on an inner time split of the
 * calibration block (${innerVal.length} rows, ${valIndepY.length} non-overlapping), never on the holdout.
 */
export interface DirectionBucketStat {
  low: number;
  high: number;
  samples: number;
  accuracy: number;
}

export interface DirectionValidation {
  from: string;
  to: string;
  samples: number;
  accuracy: number;
  auc: number;
}

export interface DirectionModelParameters {
  version: string;
  generatedAt: string;
  trainedThrough: string;
  horizonBars: number;
  barrierAtr: number;
  samples: number;
  baseRateUp: number;
  intercept: number;
  /** Feature names, in the same order as weights/means/stds. */
  features: string[];
  weights: number[];
  means: number[];
  stds: number[];
  strongCutoff: number;
  mediumCutoff: number;
  calibrationBuckets: DirectionBucketStat[];
  validation: DirectionValidation;
  /** Plain-language limit of the evidence, shown in the UI. */
  caveat: string;
}

export const DIRECTION_MODEL: DirectionModelParameters = {  version: "logistic-direction-v1",
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  trainedThrough: ${JSON.stringify(trainedThrough)},
  horizonBars: ${HORIZON_BARS},
  barrierAtr: ${BARRIER_ATR},
  samples: ${calibration.length},
  baseRateUp: ${Number(baseUpCal.toFixed(4))},
  intercept: ${Number(best.intercept.toFixed(6))},
  features: ${JSON.stringify(USED_FEATURES)},
  weights: [${best.weights.map((value) => Number(value.toFixed(6))).join(", ")}],
  means: [${means.map((value) => Number(value.toFixed(6))).join(", ")}],
  stds: [${stds.map((value) => Number(value.toFixed(6))).join(", ")}],
  strongCutoff: ${strongCutoff},
  mediumCutoff: ${mediumCutoff},
  calibrationBuckets: [
${calibrationBuckets.map((bucket) => `    { low: ${bucket.low}, high: ${bucket.high}, samples: ${bucket.samples}, accuracy: ${bucket.accuracy} },`).join("\n")}
  ],
  validation: {
    from: ${JSON.stringify(new Date(oosIndependent[0].time).toISOString())},
    to: ${JSON.stringify(new Date(oosIndependent[oosIndependent.length - 1].time).toISOString())},
    samples: ${oosIndependent.length},
    accuracy: ${Number(holdoutAcc.toFixed(3))},
    auc: ${Number(holdoutAuc.toFixed(3))},
  },
  caveat: ${JSON.stringify(caveat)},
};
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "DirectionModelCoefficients.ts");
if (!READ_HOLDOUT) {
  process.stdout.write("\nSkipped writing coefficients because the holdout was not read.\n");
  process.exit(0);
}
await writeFile(target, source, "utf8");
process.stdout.write(`\nWrote ${target}\n`);
process.stdout.write(
  `Validation summary: independent holdout ${oosIndependent.length} rows, ` +
  `acc ${holdoutAcc.toFixed(3)}, auc ${holdoutAuc.toFixed(3)}, ` +
  `score>=${strongCutoff === 101 ? 55 : strongCutoff} acc ${strongHoldout.acc.toFixed(3)} on n=${strongHoldout.n}\n`,
);
