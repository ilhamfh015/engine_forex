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
      const report = runConfidenceBacktest(pair, m15Result.value, h1Result.value, {
        includeSamples: true,
      });
      reports.push(report);
      process.stdout.write(
        `${pair}: ${report.candlesM15} closed M15 bars, ${report.candlesH1} closed H1 bars, M15 window ${report.m15From} → ${report.m15To}, ${report.samples?.length ?? 0} score samples.\n`,
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

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

interface BandAggregate {
  trades: number;
  wins: number;
  netR: number;
}

const neutralOosByBand = new Map<string, BandAggregate>();
const neutralOosFine = new Map<string, BandAggregate>();

function addAggregate(
  store: Map<string, BandAggregate>,
  key: string,
  trades: number,
  wins: number,
  expectancy: number | null,
) {
  const aggregate = store.get(key) ?? { trades: 0, wins: 0, netR: 0 };
  aggregate.trades += trades;
  aggregate.wins += wins;
  aggregate.netR += (expectancy ?? 0) * trades;
  store.set(key, aggregate);
}

for (const report of reports) {
  const neutralOos = report.scenarios
    .find((scenario) => scenario.scoreScenario === "news-neutral")
    ?.periods.find((period) => period.name === "out-of-sample");
  for (const bucket of neutralOos?.buckets ?? []) {
    addAggregate(neutralOosByBand, bucket.scoreBand, bucket.trades, bucket.wins, bucket.expectancyNetRAt005Cost);
  }
  for (const bucket of neutralOos?.fineBuckets ?? []) {
    addAggregate(neutralOosFine, bucket.scoreBand, bucket.trades, bucket.wins, bucket.expectancyNetRAt005Cost);
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
  "Fine-grained 5-point score bins are exported in confidence-fine-buckets-*.csv; use them to find where expectancy actually turns positive before moving a threshold.",
  ...Array.from(neutralOosFine, ([bucket, aggregate]) => ({ bucket, aggregate }))
    .filter(({ aggregate }) => aggregate.trades >= 5)
    .sort((a, b) => (b.aggregate.netR / b.aggregate.trades) - (a.aggregate.netR / a.aggregate.trades))
    .slice(0, 5)
    .map(({ bucket, aggregate }) => {
      const expectancy = aggregate.netR / aggregate.trades;
      const winRate = aggregate.wins / aggregate.trades * 100;
      return `Top fine bin ${bucket}: ${aggregate.trades} trades, ${winRate.toFixed(1)}% win rate, ${expectancy.toFixed(3)}R expectancy after 0.05R friction.`;
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
    "Score samples are observational. A sample marked not-simulated was counted in the score distribution but skipped by the one-position-at-a-time simulation.",
  ],
};
const jsonPath = path.join(outputDir, `confidence-backtest-${dateTag}.json`);
await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const csvRows = ["pair,scenario,period,score_band,signals,orders_placed,unfilled_orders,trades,wins,win_rate_pct,avg_gross_r,expectancy_0_cost_r,expectancy_005_cost_r,expectancy_010_cost_r,max_drawdown_005_cost_r"];
const fineRows = ["pair,scenario,period,score_bucket_5,signals,orders_placed,unfilled_orders,trades,wins,win_rate_pct,avg_gross_r,expectancy_0_cost_r,expectancy_005_cost_r,expectancy_010_cost_r,max_drawdown_005_cost_r"];

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
      for (const bucket of period.fineBuckets) {
        fineRows.push([
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

const signalRows = [
  "pair,scenario,period,signal_at,score,score_band,score_bucket_5,direction,h1_market_state,m15_market_state,h1_structure,m15_structure,timeframe_aligned,risk_reward,entry,stop_loss,tp1,tp2,tp3,order_simulated,filled,outcome,gross_r,net_r_005,exit_at,checklist_passed,checklist_failed,checklist_credits,checklist_points,rsi_m15,dist_ema_atr,value_zone_dist_atr,bars_since_pullback,adx_min",
];
for (const report of reports) {
  for (const sample of report.samples ?? []) {
    const passed = sample.checklist.filter((item) => item.passed).map((item) => item.label).join("|");
    const failed = sample.checklist.filter((item) => !item.passed).map((item) => item.label).join("|");
    const credits = sample.checklist.map((item) => `${item.label}=${item.credit}`).join("|");
    const points = sample.checklist.map((item) => `${item.label}=${item.points}`).join("|");
    signalRows.push([
      csvCell(sample.pair),
      csvCell(sample.scoreScenario),
      csvCell(sample.period),
      csvCell(sample.signalAt),
      sample.score,
      csvCell(sample.scoreBand),
      csvCell(sample.scoreBucket5),
      csvCell(sample.direction),
      csvCell(sample.h1MarketState),
      csvCell(sample.m15MarketState),
      csvCell(sample.h1Structure),
      csvCell(sample.m15Structure),
      sample.timeframeAligned,
      sample.riskRewardRatio,
      sample.entryPrice,
      sample.stopLoss,
      sample.takeProfit1,
      sample.takeProfit2,
      sample.takeProfit3,
      sample.orderSimulated,
      sample.filled,
      csvCell(sample.outcome),
      sample.grossR ?? "",
      sample.netRAt005Cost ?? "",
      csvCell(sample.exitAt),
      csvCell(passed),
      csvCell(failed),
      csvCell(credits),
      csvCell(points),
      sample.metrics.rsiM15,
      sample.metrics.distanceEmaAtr,
      sample.metrics.valueZoneDistanceAtr,
      sample.metrics.barsSincePullback,
      sample.metrics.adxMin,
    ].join(","));
  }
}

const csvPath = path.join(outputDir, `confidence-backtest-${dateTag}.csv`);
const finePath = path.join(outputDir, `confidence-fine-buckets-${dateTag}.csv`);
const signalPath = path.join(outputDir, `confidence-signals-${dateTag}.csv`);
await writeFile(csvPath, `${csvRows.join("\n")}\n`, "utf8");
await writeFile(finePath, `${fineRows.join("\n")}\n`, "utf8");
await writeFile(signalPath, `${signalRows.join("\n")}\n`, "utf8");

process.stdout.write(`\nSaved reports:\n${jsonPath}\n${csvPath}\n${finePath}\n${signalPath}\n`);
process.stdout.write(`Successful pair replays: ${reports.length}/${SUPPORTED_PAIRS.length}; provider/data failures: ${dataErrors.length}.\n`);
for (const finding of findings) process.stdout.write(`Finding: ${finding}\n`);
if (dataErrors.length > 0) {
  process.stderr.write(`${JSON.stringify(dataErrors, null, 2)}\n`);
  // Partial success is still useful: the reports are already written and can
  // be calibrated. Only a run with no usable pair should fail the command.
  if (reports.length === 0) process.exitCode = 1;
}
