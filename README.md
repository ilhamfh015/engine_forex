# Forex Market Structure Analyzer

A decision-support dashboard for multi-timeframe forex analysis, entry planning, and risk context. It does not execute broker trades.

## Stack

- React, Vite, TypeScript, Tailwind CSS
- Express API deployed as a Vercel Node.js Function
- PostgreSQL with Drizzle ORM
- Twelve Data for OHLC candles

## Run locally

Use Node.js 24 and pnpm 12.18.0.

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/forex-dashboard run dev
```

Run the API in a second terminal, with `TWELVE_DATA_API_KEY` set in that terminal:

```powershell
$env:PORT = "3001"
$env:TWELVE_DATA_API_KEY = "<your Twelve Data API key>"
pnpm --filter @workspace/api-server exec tsx src/local-runner.ts
```

Alternatively, `pnpm --filter @workspace/api-server run dev` builds and starts the same local runner. The `src/index.ts` module only exports the Vercel handler and does not listen on a port.

The Vite dev server proxies `/api` requests to `http://127.0.0.1:3001` by default; set `API_PROXY_TARGET` to override it. `DATABASE_URL` is optional for local analysis. Without it, analysis snapshots are not stored and the history endpoint is unavailable. Run `pnpm --filter @workspace/api-server test` for service tests and `pnpm run typecheck` for workspace type checks.

## Deploy to Vercel

Import this repository into Vercel with the **repository root** as the project root. [vercel.json](./vercel.json) configures three services: the dashboard is public at `/`, the Express API is public at `/api/*`, and the mockup sandbox remains internal. The browser calls the API through the same-origin public rewrite, so no service binding is needed.

Add these environment variables to Vercel for Preview and Production:

- `DATABASE_URL` — PostgreSQL connection string. Use the pooled/serverless connection URL recommended by your database provider.
- `TWELVE_DATA_API_KEY` — Twelve Data API key.

Before the first deployment, apply the database schema from a trusted local environment with `DATABASE_URL` configured:

```sh
pnpm --filter @workspace/db run push
```

The API uses one PostgreSQL connection per warm Vercel instance to avoid multiplying connection pools during scale-out. Vercel and the Twelve Data account each enforce their own function-duration and provider-quota limits.

The dashboard calls the API through same-origin `/api/*` routes; no public API URL or cross-origin setup is needed.

The all-pairs overview fetches H1 and M15 candles for five instruments. Its cold-start requests are deliberately rate-limited for Twelve Data's free quota, so the first overview can take over a minute; `vercel.json` allows up to 300 seconds for the API function. Confirm that the selected Vercel plan allows this duration and that the Twelve Data plan has sufficient quota. The in-memory rate limiter and candle/news caches are per function instance, not shared across concurrent instances.

## Workspace map

- `artifacts/forex-dashboard/` — Vite dashboard
- `artifacts/api-server/` — Express routes and market-analysis services
- `lib/api-spec/openapi.yaml` — API contract source
- `lib/db/src/schema/` — Drizzle database schema

## Analysis notes

- Signals are calculated from closed candles.
- H1/M15 alignment, news risk, and checklist results affect advisory scores and setup labels; they do not hard-block directional plans.
- The score is additive and uses **partial credit**: each factor earns a `credit` between 0 and 1, and its points are `round(weight × credit × 100)`. The displayed score is the sum of those per-item points, so the dashboard number can be reconciled by adding the list together. It is **not capped or clamped** by critical gaps. Missing alignment/confirmation, low reward/risk, high-risk news, or a stale entry are surfaced as advisories next to the score (and a plan below `1R` still marks the setup `WAIT`), but they never rewrite the number.
- Checklist weights (they sum to 1.00): DMI/ADX 0.24, value zone 0.22, reward/risk 0.19 (continuous `RR/3`), alignment 0.16, entry freshness 0.14, confirmation candle 0.05. Swing structure, momentum, and news carry weight 0: structure and momentum did not keep the same sign across the two splits, and the replay has no historical news, so the old 0.10 news weight was a constant `+10` on every trade rather than a discriminator. Headline risk is still shown as an advisory.
- "Entry freshness" is the anti-late-entry factor, added because the previous engine's highest score bins were negative: setups where every binary factor passed tended to be entries taken after the move had already run. It scores `0.6 ×` (bars since price last traded within 0.5 ATR of the M15 EMA21, full credit at 0 bars, zero at 24) `+ 0.4 ×` RSI extremity (full at RSI ≤ 65 for buys / ≥ 35 for sells, zero at ≥ 78 / ≤ 22). The constants were fixed before fitting; only its weight was fitted. Partial credit is used for the other factors too: alignment keeps 0.5 when the timeframes agree but one is still transitioning, value zone tapers from 1.0 within 0.5 ATR to 0.6 at 1 ATR, and confirmation keeps 0.5 for a weaker directional candle. This also removes the old score pile-ups at 44/45 where a single checklist point decided the band.
- Confidence uses four data-driven bands: `55-100` (High), `45-54` (Medium), `35-44` (Low), and `0-34` (VeryLow). On the five-pair replay of this engine (2,278 filled news-neutral trades, calibration 1,595 / holdout 683) the bands are monotonic in both splits — calibration `-0.251 / -0.123 / +0.008 / +0.126` and holdout `-0.261 / +0.052 / +0.089 / +0.177` after 0.05R friction — and the High band is positive on four of five holdout pairs (`EURUSD +0.10` on 30 trades, `GBPUSD +0.36` on 20, `USDJPY -0.24` on 18, `XAUUSD +0.20` on 26, `BTCUSD +0.39` on 27; 121 trades total). The cutoffs are provisional and should be re-checked as more history arrives. The dashboard colors them green, amber, orange, and red.
- A chronological walk-forward check (five equal time buckets over the same 2,278-trade sample) is the honest caveat for these bands: the `0-34` band was negative in all five buckets, the `55-100` band was positive in all five, but the full band ordering was monotonic in only three of the five short windows. Read monotonicity as an aggregate property of the whole sample, not a promise for any single week. The mid-bands (`35-44`, `45-54`) are the noisiest; the reliable claims are "below 35 leans negative" and "55+ leans positive".
- The top of the score is now usable, which was the main defect being fixed. The previous no-cap engine scored the holdout `85-89` bin at −0.324R over 29 trades; with freshness plus partial credit the high bins are positive (`75-79 +0.343R` on 15 trades, `80-84 +0.202R` on 16, `85-89 +0.234R` on 7, `>=80 +0.231R` on 25, `>=70 +0.150R` on 66). The `70-74` bin is still slightly negative (`-0.040R`, 26 trades), so "≥75" is the region with consistent evidence rather than "every score above 70".
- Fitting the cutoffs again on the calibration split prefers `15/46/71` (adjacent-band step 0.215 versus 0.119 for `35/45/55`), and the built-in `backtest:calibrate` suggests `15/20/70`. Both were rejected on the pre-declared adoption gate: `15/46/71` holds only 61 High-band trades and 18 in its bottom band on the holdout (70 High-band trades required), and `15/20/70` earns `+0.150R` on its top band versus `+0.177R` for `55-100` while pooling almost every trade into one `20-69` tier. `35/45/55` stays because it is monotonic in both splits and keeps a 121-trade High band.
- Confidence is a heuristic score, not a calibrated probability or a guarantee of results.
- News headlines and calendar data are risk context, not market predictions.
- `GET /api/analysis/:pair/backtest` replays the M15 setup over a longer candle window and returns calibration plus chronological holdout results per score band. The report is cached in memory and does not require `DATABASE_URL`.
- The dashboard loads the backtest on demand from the "Validasi skor" panel so it does not add latency to the initial analysis.
- `pnpm --filter @workspace/api-server backtest:confidence` writes aggregate CSV/JSON plus five-point score buckets and per-signal samples (`confidence-signals-*.csv`). It needs `TWELVE_DATA_API_KEY`.
- `pnpm --filter @workspace/api-server backtest:calibrate` reads the newest per-signal JSON, fits candidate band cutoffs on the calibration period, then evaluates them unchanged on the holdout. It never writes to the database and never edits live weights.
- Per-signal samples include score, five-point bucket, direction, H1/M15 state and structure, checklist results, setup levels, and the simulated net R outcome. This is the data source for future weight/band tuning.
