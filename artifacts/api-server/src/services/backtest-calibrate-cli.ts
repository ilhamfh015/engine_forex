/**
 * Offline score-band calibration.
 *
 * Reads the per-signal samples written by backtest-cli, fits candidate band
 * cutoffs on the calibration period, then evaluates them unchanged on the
 * chronological holdout. No database and no live-scoring changes.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cumulativeCutoffTable,
  evaluateScoreBands,
  suggestScoreBands,
  type CalibrationBandStat,
  type CalibrationTrade,
} from "./ScoreCalibrationService.js";

interface StoredSample {
  scoreScenario: string;
  period: string;
  score: number;
  outcome: string;
  netRAt005Cost: number | null;
}

interface StoredReport {
  pair: string;
  samples?: StoredSample[];
}

interface StoredPayload {
  generatedAt?: string;
  reports: StoredReport[];
}

const scenario = process.env.CALIBRATION_SCENARIO ?? "news-neutral";
const fitPeriod = process.env.CALIBRATION_FIT_PERIOD ?? "calibration";
const evalPeriod = process.env.CALIBRATION_EVAL_PERIOD ?? "out-of-sample";
const requestedMinTrades = Number(process.env.CALIBRATION_MIN_TRADES ?? 10);

async function resolveInput(): Promise<string> {
  const explicit = process.argv[2];
  if (explicit) return path.resolve(process.cwd(), explicit);

  const dir = path.resolve(process.cwd(), "backtest-results");
  const names = (await readdir(dir)).filter((name) => /^confidence-backtest-.*\.json$/.test(name));
  if (names.length === 0) {
    throw new Error(`No confidence-backtest-*.json files found in ${dir}. Run backtest:confidence first.`);
  }

  const withTimes = await Promise.all(names.map(async (name) => {
    const full = path.join(dir, name);
    return { full, mtime: (await stat(full)).mtimeMs };
  }));
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return withTimes[0].full;
}

function toTrades(samples: StoredSample[], period: string): CalibrationTrade[] {
  return samples
    .filter((sample) => sample.scoreScenario === scenario)
    .filter((sample) => sample.period === period)
    .filter((sample) => (sample.outcome === "win" || sample.outcome === "loss") && sample.netRAt005Cost !== null)
    .map((sample) => ({ score: sample.score, netR: sample.netRAt005Cost! }));
}

function formatNullable(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value}${suffix}`;
}

function tableRows(label: string, bands: CalibrationBandStat[]): string[] {
  return bands.map((band) => [
    label,
    band.key,
    band.trades,
    formatNullable(band.winRate, "%"),
    formatNullable(band.expectancyNetR, "R"),
    formatNullable(band.maxDrawdownR, "R"),
  ].join("\t"));
}

async function main() {
  if (!Number.isFinite(requestedMinTrades) || requestedMinTrades < 1) {
    throw new Error("CALIBRATION_MIN_TRADES must be a positive number.");
  }

  const inputPath = await resolveInput();
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as StoredPayload;
  const samples = payload.reports.flatMap((report) => report.samples ?? []);

  if (samples.length === 0) {
    throw new Error(
      "The selected JSON has no per-signal samples. Re-run backtest:confidence with the updated CLI.",
    );
  }

  const fitTrades = toTrades(samples, fitPeriod);
  const evalTrades = toTrades(samples, evalPeriod);

  if (fitTrades.length === 0 || evalTrades.length === 0) {
    throw new Error(
      `Not enough filled ${scenario} trades: fit=${fitTrades.length}, evaluation=${evalTrades.length}.`,
    );
  }

  const suggestion = suggestScoreBands(fitTrades, { minTrades: requestedMinTrades });
  const fittedHoldout = evaluateScoreBands(evalTrades, suggestion.cutoffs);
  const fixedHoldout = evaluateScoreBands(evalTrades, [35, 45, 55]);
  const cumulative = cumulativeCutoffTable(evalTrades);

  const out: string[] = [];
  out.push(`Input: ${inputPath}`);
  if (payload.generatedAt) out.push(`Backtest generated: ${payload.generatedAt}`);
  out.push(`Scenario: ${scenario}`);
  out.push(`Fit period: ${fitPeriod} (${fitTrades.length} filled trades)`);
  out.push(`Evaluation period: ${evalPeriod} (${evalTrades.length} filled trades)`);
  out.push("");
  out.push(
    `Suggested cutoffs from ${fitPeriod}: orange>=${suggestion.cutoffs[0]}, yellow>=${suggestion.cutoffs[1]}, green>=${suggestion.cutoffs[2]}`,
  );
  out.push(
    `Reliable: ${suggestion.reliable ? "yes" : "no"} (${
      suggestion.minTradesUsed > 0 ? `minimum ${suggestion.minTradesUsed} trades per band` : "insufficient samples"
    })`,
  );
  for (const warning of suggestion.warnings) out.push(`Warning: ${warning}`);
  out.push("");
  out.push(
    "These cutoffs were fitted on the calibration period only. Adopt them only if they beat the fixed",
  );
  out.push(
    "35/45/55 bands on the holdout and remain stable across pairs and time windows.",
  );
  out.push("");
  out.push(`Holdout with suggested cutoffs (${evalPeriod}):`);
  out.push("band\twin_rate\texpectancy_005\tmax_dd");
  for (const band of fittedHoldout) {
    out.push([
      band.key,
      formatNullable(band.winRate, "%"),
      formatNullable(band.expectancyNetR, "R"),
      formatNullable(band.maxDrawdownR, "R"),
    ].join("\t"));
  }
  out.push("");
  out.push(`Holdout with the current 35/45/55 bands (${evalPeriod}):`);
  out.push("band\twin_rate\texpectancy_005\tmax_dd");
  for (const band of fixedHoldout) {
    out.push([
      band.key,
      formatNullable(band.winRate, "%"),
      formatNullable(band.expectancyNetR, "R"),
      formatNullable(band.maxDrawdownR, "R"),
    ].join("\t"));
  }
  out.push("");
  out.push(`Cumulative score cutoffs on the holdout (score >= cutoff):`);
  out.push("cutoff\ttrades\twin_rate\texpectancy_005\tmax_dd");
  for (const row of cumulative) {
    out.push([
      row.key,
      row.trades,
      formatNullable(row.winRate, "%"),
      formatNullable(row.expectancyNetR, "R"),
      formatNullable(row.maxDrawdownR, "R"),
    ].join("\t"));
  }

  process.stdout.write(`${out.join("\n")}\n`);

  const csv = [
    "source,band,min,max,trades,win_rate_pct,expectancy_005_cost_r,max_drawdown_005_cost_r",
    ...tableRows(`suggested_holdout`, fittedHoldout).map((row) => row.replace(/\t/g, ",")),
    ...tableRows(`fixed_holdout`, fixedHoldout).map((row) => row.replace(/\t/g, ",")),
    ...cumulative.map((row) => [
      "cumulative_holdout",
      row.key,
      row.min,
      row.max,
      row.trades,
      row.winRate ?? "",
      row.expectancyNetR ?? "",
      row.maxDrawdownR ?? "",
    ].join(",")),
  ];

  const outputPath = path.resolve(
    process.cwd(),
    "backtest-results",
    `confidence-calibration-${new Date().toISOString().slice(0, 10)}.csv`,
  );
  await writeFile(outputPath, `${csv.join("\n")}\n`, "utf8");
  process.stdout.write(`\nSaved calibration table: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
