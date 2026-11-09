import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_PAIRS } from "./MarketStructureService.js";
import { runConfidenceBacktest } from "./ConfidenceBacktestService.js";
import { getCandles } from "./TwelveDataService.js";

const requestedCount = Number(process.env.BACKTEST_CANDLES ?? 5000);
if (!Number.isInteger(requestedCount) || requestedCount < 500 || requestedCount > 5000) {
  process.stderr.write("BACKTEST_CANDLES must be an integer from 500 to 5000.\n");
  process.exit(1);
}

const reports = [];
const dataErrors: Array<{ pair: string; timeframe: "H1" | "M15"; reason: string }> = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const pair of SUPPORTED_PAIRS) {
  process.stdout.write(`Fetching closed-candle history for ${pair}...\n`);
  const [h1Result, m15Result] = await Promise.allSettled([
    getCandles(pair, "H1", requestedCount),
    getCandles(pair, "M15", requestedCount),
  ]);

  if (h1Result.status === "rejected") {
    dataErrors.push({ pair, timeframe: "H1", reason: h1Result.reason instanceof Error ? h1Result.reason.message : "Provider request failed" });
  }
  if (m15Result.status === "rejected") {
    dataErrors.push({ pair, timeframe: "M15", reason: m15Result.reason instanceof Error ? m15Result.reason.message : "Provider request failed" });
  }

  if (h1Result.status === "fulfilled" && m15Result.status === "fulfilled") {
    try {
      const report = runConfidenceBacktest(pair, m15Result.value, h1Result.value);
      reports.push(report);
      process.stdout.write(
        `${pair}: ${report.candlesM15} closed M15 bars, ${report.candlesH1} closed H1 bars, M15 window ${report.m15From} → ${report.m15To}.\n`,
      );
    } catch (error) {
      dataErrors.push({
        pair,
        timeframe: "M15",
        reason: error instanceof Error ? error.message : "Replay failed",
      });
    }
  }

  // Keep room for the dashboard and avoid bursting the shared provider quota.
  await wait(18_000);
}

const dateTag = new Date().toISOString().slice(0, 10);
const outputDir = path.resolve(process.cwd(), "backtest-results");
await mkdir(outputDir, { recursive: true });
const neutralOosByBand = new Map<string, { trades: number; wins: number; netR: number }>();
for (const report of reports) {
  const neutralOos = report.scenarios
    .find((scenario) => scenario.scoreScenario === "news-neutral")
    ?.periods.find((period) => period.name === "out-of-sample");
  for (const bucket of neutralOos?.buckets ?? []) {
    const aggregate = neutralOosByBand.get(bucket.scoreBand) ?? { trades: 0, wins: 0, netR: 0 };
    aggregate.trades += bucket.trades;
    aggregate.wins += bucket.wins;
    aggregate.netR += (bucket.expectancyNetRAt005Cost ?? 0) * bucket.trades;
    neutralOosByBand.set(bucket.scoreBand, aggregate);
  }
}
const findings = [
  ...Array.from(neutralOosByBand, ([band, aggregate]) => {
    const expectancy = aggregate.trades
      ? (aggregate.netR / aggregate.trades).toFixed(3)
      : "n/a";
    const winRate = aggregate.trades
      ? (aggregate.wins / aggregate.trades * 100).toFixed(1)
      : "n/a";
    return `News-neutral out-of-sample score band ${band}: ${aggregate.trades} trades, ${winRate}% win rate, ${expectancy}R expectancy after assumed 0.05R friction.`;
  }),
  "These results are a short-window replay, not proof of future profitability or a calibrated win probability; preserve the per-pair drawdowns and sample counts when interpreting aggregate bands.",
  "The Risk Reward checklist scores the planned-entry-to-TP2 distance; nearby opposing structure can cap TP2 below 2R, so review this score alongside its sample count and costs.",
  "No score weights, thresholds, or setup gates were changed during this validation, so the holdout remains untouched.",
];
const payload = {
  generatedAt: new Date().toISOString(),
  requestedCandlesPerSeries: requestedCount,
  reports,
  dataErrors,
  findings,
  limitations: [
    "Historical news is not archived by the configured headline/calendar sources, so results include news-neutral and news-unavailable score scenarios rather than reconstructed historical news.",
    "The provider returns a rolling history window; M15 coverage determines the effective replay horizon.",
    "OHLC data cannot model exact intrabar sequence, bid/ask spread, queue position, or real slippage.",
  ],
};
const jsonPath = path.join(outputDir, `confidence-backtest-${dateTag}.json`);
await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const csvRows = ["pair,scenario,period,score_band,signals,orders_placed,unfilled_orders,trades,wins,win_rate_pct,avg_gross_r,expectancy_0_cost_r,expectancy_005_cost_r,expectancy_010_cost_r,max_drawdown_005_cost_r"];
for (const report of reports) {
  for (const scenario of report.scenarios) {
    for (const period of scenario.periods) {
      for (const bucket of period.buckets) {
        csvRows.push([
          report.pair,
          scenario.scoreScenario,
          period.name,
          bucket.scoreBand,
          bucket.signals,
          bucket.ordersPlaced,
          bucket.unfilledOrders,
          bucket.trades,
          bucket.wins,
          bucket.winRate ?? "",
          bucket.averageGrossR ?? "",
          bucket.expectancyNetRAt0Cost ?? "",
          bucket.expectancyNetRAt005Cost ?? "",
          bucket.expectancyNetRAt010Cost ?? "",
          bucket.maxDrawdownRAt005Cost ?? "",
        ].join(","));
      }
    }
  }
}
const csvPath = path.join(outputDir, `confidence-backtest-${dateTag}.csv`);
await writeFile(csvPath, `${csvRows.join("\n")}\n`, "utf8");

process.stdout.write(`\nSaved reports:\n${jsonPath}\n${csvPath}\n`);
process.stdout.write(`Successful pair replays: ${reports.length}/${SUPPORTED_PAIRS.length}; provider/data failures: ${dataErrors.length}.\n`);
for (const finding of findings) process.stdout.write(`Finding: ${finding}\n`);
if (dataErrors.length > 0) {
  process.stderr.write(`${JSON.stringify(dataErrors, null, 2)}\n`);
  process.exitCode = 1;
}
