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
pnpm --filter @workspace/api-server exec tsx src/index.ts
```

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
- Confidence is a heuristic score, not a calibrated probability or a guarantee of results.
- News headlines and calendar data are risk context, not market predictions.
