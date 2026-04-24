# UP Dash

## Overview

UP Dash is a B2B fashion-industry e-commerce analytics platform. It provides admins with multi-tenant oversight (clients = brands) and individual brand owners with private dashboards covering revenue, conversion funnels, customer RFM segmentation, product/seller performance, and geographic insights.

The codebase is a pnpm monorepo. Backend (Drizzle + Express + JWT auth) and frontend (React + Vite at `artifacts/up-dash`, served from `/`) live in the `artifacts/` directory; shared schema, OpenAPI spec, and generated React Query hooks live in `lib/`.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9 (strict)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (`@workspace/db`)
- **Auth**: JWT (jsonwebtoken) + bcryptjs, 1h access / 7d refresh
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec) → `@workspace/api-zod` (Zod) and `@workspace/api-client-react` (React Query)
- **Build**: esbuild (CJS bundle for the API server)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (escape hatch only — prefer migrations)
- `pnpm --filter @workspace/db run generate` — generate a new migration in `lib/db/migrations/`
- `pnpm --filter @workspace/db run migrate:bootstrap` — idempotent ledger seed; safe to run anywhere
- `pnpm --filter @workspace/db run migrate` — apply pending migrations (used by post-merge.sh and prod deploys)
- `pnpm --filter @workspace/db run seed` — seed two demo clients with realistic data
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server run test` — run vitest+supertest smoke tests against the API

## Environment Variables

- `DATABASE_URL` — required, Postgres connection string.
- `JWT_ACCESS_SECRET` — required, must be ≥32 chars. Signs short-lived (1h) access tokens.
- `JWT_REFRESH_SECRET` — not consumed by the runtime. Refresh tokens are opaque random bytes (sha256-hashed in the `sessions` table); no signing secret is needed. The variable is kept available if a future change adopts signed refresh tokens, but it is safe to leave unset.
- `ALLOWED_ORIGINS` — comma-separated CORS allowlist. Unset / `*` = permissive (development default).
- `RATE_LIMIT_AUTH_PER_MIN` — login + refresh limit per IP per minute (default 20).
- `RATE_LIMIT_API_PER_MIN` — global `/api/*` limit per IP per minute (default 300).
- `TRUST_PROXY` — Express `trust proxy` setting. Defaults to `1` (one upstream proxy hop, matches managed deployments). Set to `false`/`0` if the API is exposed directly without a trusted proxy (otherwise clients can spoof `X-Forwarded-For` and bypass IP rate limits). Numeric values set hop count; any other string is passed through (e.g. `loopback`, CIDR).
- `LOG_LEVEL` — pino log level, default `info`.

### Input validation

`POST /api/clients` enforces ISO 4217 (`^[A-Z]{3}$`) for `currency` and a BCP 47 shape (`^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$`) for `locale`, returning `400 VALIDATION_ERROR` when malformed.

## Demo Credentials (seed script)

- Admin: `admin@updash.com` / `Admin123!` (sees all clients, must pass `?clientId=...` for analytics)
- Aurora Atelier (client): `owner@aurora.com` / `Client123!`
- Noir Studio (client): `owner@noir.com` / `Client123!`

## Architecture Notes

- **Schema** (`lib/db/src/schema/`): users, clients, customers, products, sellers, orders/order_items, events, creatives. All PKs are nanoid TEXT; all timestamps timestamptz; FKs use cascade or set-null. Customer/product denormalized counters are kept in sync by the seeder.
- **Multi-tenancy**: every domain table has `clientId`. The `resolveClientId(req)` helper in `middlewares/auth.ts` enforces tenant scope: ADMIN may pass `?clientId=...`; CLIENT users always operate on their own client.
- **Auth flow**: `/auth/login` returns a short-lived JWT access token (1h) and an opaque refresh token (7d) plus the user payload. The refresh token is stored hashed (sha256) in the `sessions` table along with userAgent/ip metadata. `/auth/refresh` is single-use rotation: it revokes the presented session row and issues a fresh refresh token. `/auth/logout` accepts an optional `refreshToken` body and revokes that session. The frontend `lib/auth.tsx` registers an `UnauthorizedHandler` so any 401 from the generated React Query hooks transparently refreshes the token and retries the original request exactly once; concurrent 401s share a single refresh attempt.
- **Production hardening**: helmet (no CSP, JSON-only API), gzip compression, CORS allowlist, two-tier rate limiting (`/auth/login` + `/auth/refresh` stricter than the global `/api` limiter), pino with `password`/`refreshToken`/`accessToken` redaction, `/healthz` does a live `SELECT 1` and returns 503 + `db: "error"` when the database is unreachable, drizzle migrations are committed under `lib/db/migrations/` for production rollouts.
- **Analytics endpoints** (`/analytics/*`): dashboard KPIs + daily series, conversion funnel (monotonic, clamped to 100%), paginated customers with RFM segment counts, product ranking, seller leaderboard, and state/city geography breakdowns. All queries are real Drizzle SQL — no mocks.
- **Events table**: source of truth for funnel/conversion analytics. Seeded with VISIT, REGISTRATION, APPROVED_REGISTRATION, ADD_TO_CART, CHECKOUT_STARTED, PURCHASE per customer journey.
- **Frontend** (`artifacts/up-dash`): React + Vite + wouter + TanStack Query + shadcn/ui + Recharts. Auth state in `lib/auth.tsx` persists tokens and user to localStorage (`updash.token`, `updash.refresh`, `updash.user`, `updash.clientId`). 401 responses trigger a single refresh-and-retry cycle inside the shared fetcher; if the refresh itself fails, local state is cleared and the route guard sends the user to `/login`. Pages: `/login`, `/dashboard`, `/funnel`, `/customers`, `/products`, `/sellers`, `/geography`, `/clients` (admin only). Date-range filter defaults to last 30 days. Admin users auto-pick the first client on load (analytics endpoints require a `clientId`); CLIENT users have a fixed `clientId` from JWT and don't see the picker.
- **Per-client currency/locale**: the `clients` table carries `currency` (ISO 4217, default BRL) and `locale` (BCP 47, default pt-BR). When the active client changes in the topbar, `setActiveCurrency` retints every formatter in the app, so revenue numbers render in the brand's home currency without each component being currency-aware. The `New Client` dialog exposes a curated list of currency+locale presets.
- **Generated hooks gotcha**: orval-generated React Query hooks type the `query` option as `UseQueryOptions<...>` which (in TanStack Query v5) requires `queryKey`. The runtime fills it in via the generated `getXyzQueryKey()` helper, so consumers wrap their option object in `queryOpts({ ... })` from `src/lib/query-opts.ts` to satisfy the typing.
- **`GET /clients/:clientId` access**: ADMIN can read any client; CLIENT can read only their own (used by the topbar to show the brand name).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
