# Forex Market Structure Analyzer

A single-page professional trading dashboard that helps Forex traders analyze market structure, entry confidence, and trend direction — without executing trades.

## Run & Operate

- `pnpm --filter @workspace/forex-dashboard run dev` — run the frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, TailwindCSS v4, Framer Motion, Lucide React
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — Single source of truth for all API contracts
- `lib/db/src/schema/marketAnalysis.ts` — Market analysis DB table schema
- `artifacts/api-server/src/services/` — All business logic (MarketStructureService, EntryConfidenceService, SummaryService, TradingViewService)
- `artifacts/api-server/src/routes/analysis.ts` — Dashboard API routes
- `artifacts/forex-dashboard/src/pages/Dashboard.tsx` — Main dashboard page
- `artifacts/forex-dashboard/src/components/` — Reusable UI components (TrendCard, ConfidenceCard, SummaryCard, PairsOverview, TradingViewWidget, Header)

## Architecture decisions

- **Service Pattern**: All business logic lives in `artifacts/api-server/src/services/`. Controllers (routes) are thin — only HTTP in/out.
- **Live data and safety filters**: Twelve Data supplies OHLC candles; signals only use closed candles. H1 and M15 must both be trending and aligned before an entry can be allowed.
- **Confidence scoring**: Weighted confluence checklist covers timeframe alignment, confirmed structure, DMI/ADX, value zone, closed-candle confirmation, healthy momentum, planned RR, and news risk. High-impact or unavailable news blocks entry; caution news penalizes confidence.
- **News risk**: Recent pair-relevant headlines and upcoming economic events are cached for 10 minutes. Headline data comes from Google News RSS; scheduled release data comes from the public Forex Factory calendar feed and is shown in Asia/Jakarta time. This is a conservative risk filter, not a sentiment guarantee.
- **DB snapshots**: Every `/analysis/:pair` request fire-and-forgets a snapshot to `market_analysis` table for history tracking and future ML training.
- **Dark mode**: Forced via `class="dark"` on `<html>` in `index.html`. Do NOT use `@apply dark` in CSS — it's not a utility class in TailwindCSS v4.

## Product

- Supported pairs: EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD
- Trend H1 & M15: BUY (HH-HL) or SELL (LH-LL)
- Entry Confidence: 0–100% with circular progress bar
- Entry Analysis: confluence checklist with pass/fail per condition
- News Risk Filter: CLEAR / CAUTION / BLOCKED / UNAVAILABLE with recent headlines
- Market Summary: bias, confidence %, confidence level, narrative reason
- All Pairs Overview: clickable strip showing all 5 pairs at a glance
- TradingView Widget: embeds live chart for selected pair
- Auto-refresh: every 60 seconds via React Query `refetchInterval`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **TailwindCSS v4 dark mode**: Use `class="dark"` on `<html>`, never `@apply dark` in CSS (causes "Cannot apply unknown utility class `dark`" error)
- **Zod v3 integers**: Use `type: number` not `type: integer` in OpenAPI spec. Orval generates `zod.int()` for integers which doesn't exist in Zod v3.
- **Orval param name collisions**: When an operation has both path params AND query params, they both generate a type named `{OperationId}Params`, causing TS2308. Solution: remove query params or rename the operation.
- **API client imports**: Always import from `@workspace/api-client-react`, never from `@workspace/api-client-react/generated/api` (not an exported subpath).
- **lib declarations**: After changing `lib/db/src/schema/`, run `pnpm run typecheck:libs` before checking artifact packages, otherwise new exports won't be visible.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- To connect real MT5 data: replace `MarketStructureService.ts` `analyzeTrend()` and `EntryConfidenceService.ts` `conditionPassed()` with live broker API calls
