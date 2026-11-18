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
- The score is purely additive: `100 ×` the checklist/news weights that pass. It is **not capped or clamped** by critical gaps. Missing alignment/confirmation, low reward/risk, or high-risk news are surfaced as advisories next to the score (and a plan below `1R` still marks the setup `WAIT`), but they never rewrite the number. This is intentional: clamping hid setups behind a score the checklist could not explain and, when the score ceiling was removed, the previously capped weights no longer ordered the bands well.
- Checklist weights are backtest-fitted for this no-cap score and checked unchanged on the chronological holdout: alignment 0.15, value zone 0.30, DMI/ADX 0.22, confirmation candle 0.06, reward/risk 0.17 (scored continuously as RR/3, capped at 1), and news 0.10 (scored continuously from provider risk). Swing structure and momentum carry weight 0: neither kept the same sign across the two splits, so they stay in the checklist as visible context only. Reward/risk carries more weight than in the capped engine because, without a hard ceiling, the planned distance-to-target is the main discriminator the score must express directly.
- Confidence uses four data-driven bands: `55-100` (High), `45-54` (Medium), `35-44` (Low), and `0-34` (VeryLow). On the full five-pair replay of the no-cap engine (2,291 filled news-neutral trades, calibration 1,587 / holdout 704) the bands are monotonic in both splits — calibration `-0.257 / -0.075 / -0.059 / +0.146` and holdout `-0.286 / -0.031 / +0.135 / +0.173` after 0.05R friction — and the High band is positive on all five pairs in the holdout (`EURUSD +0.23`, `GBPUSD +0.32`, `USDJPY +0.10`, `XAUUSD +0.05`, `BTCUSD +0.15`; 105 trades total). The cutoffs are provisional and should be re-checked as more history arrives. The dashboard colors them green, amber, orange, and red.
- A chronological walk-forward check (five equal time buckets over the same 2,291-trade sample) is the honest caveat for these bands: the `0-34` band was negative in all five buckets, the `55-100` band was positive in four of five (the second bucket's High band was −0.009R, effectively flat), but the full band ordering was monotonic in only three of the five short windows. Read monotonicity as an aggregate property of the whole sample, not a promise for any single week. The mid-bands (`35-44`, `45-54`) are the noisiest; the reliable claims are "below 35 leans negative" and "55+ leans positive".
- Removing the RR/critical-gap caps traded a smaller, cleaner High band for a larger, uncapped one: the capped engine's High band was +0.521R on 42 holdout trades, while the no-cap engine's is +0.173R on 105. This is the expected cost of not rewriting the score — more setups reach the top band, including ones with low planned RR, so the edge is thinner and must be read together with the advisories and the setup label. `backtest:calibrate` on the no-cap engine suggests alternatives such as `20/80/85`, but on the holdout their top tier is negative (80+ loses heavily) while `35/45/55` stays monotonic in both splits, so 35/45/55 is kept.
- Confidence is a heuristic score, not a calibrated probability or a guarantee of results.
- News headlines and calendar data are risk context, not market predictions.
- `GET /api/analysis/:pair/backtest` replays the M15 setup over a longer candle window and returns calibration plus chronological holdout results per score band. The report is cached in memory and does not require `DATABASE_URL`.
- The dashboard loads the backtest on demand from the "Validasi skor" panel so it does not add latency to the initial analysis.
- `pnpm --filter @workspace/api-server backtest:confidence` writes aggregate CSV/JSON plus five-point score buckets and per-signal samples (`confidence-signals-*.csv`). It needs `TWELVE_DATA_API_KEY`.
- `pnpm --filter @workspace/api-server backtest:calibrate` reads the newest per-signal JSON, fits candidate band cutoffs on the calibration period, then evaluates them unchanged on the holdout. It never writes to the database and never edits live weights.
- Per-signal samples include score, five-point bucket, direction, H1/M15 state and structure, checklist results, setup levels, and the simulated net R outcome. This is the data source for future weight/band tuning.
