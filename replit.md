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
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run seed` — seed two demo clients with realistic data
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Demo Credentials (seed script)

- Admin: `admin@updash.com` / `Admin123!` (sees all clients, must pass `?clientId=...` for analytics)
- Aurora Atelier (client): `owner@aurora.com` / `Client123!`
- Noir Studio (client): `owner@noir.com` / `Client123!`

## Architecture Notes

- **Schema** (`lib/db/src/schema/`): users, clients, customers, products, sellers, orders/order_items, events, creatives. All PKs are nanoid TEXT; all timestamps timestamptz; FKs use cascade or set-null. Customer/product denormalized counters are kept in sync by the seeder.
- **Multi-tenancy**: every domain table has `clientId`. The `resolveClientId(req)` helper in `middlewares/auth.ts` enforces tenant scope: ADMIN may pass `?clientId=...`; CLIENT users always operate on their own client.
- **Auth flow**: `/auth/login` returns access+refresh tokens and the user payload (with `clientId` for clients). `/auth/me` is the rehydration endpoint. `/auth/refresh` rotates the access token.
- **Analytics endpoints** (`/analytics/*`): dashboard KPIs + daily series, conversion funnel (monotonic, clamped to 100%), paginated customers with RFM segment counts, product ranking, seller leaderboard, and state/city geography breakdowns. All queries are real Drizzle SQL — no mocks.
- **Events table**: source of truth for funnel/conversion analytics. Seeded with VISIT, REGISTRATION, APPROVED_REGISTRATION, ADD_TO_CART, CHECKOUT_STARTED, PURCHASE per customer journey.
- **Frontend** (`artifacts/up-dash`): React + Vite + wouter + TanStack Query + shadcn/ui + Recharts. Auth state in `lib/auth.tsx` persists JWT and user to localStorage (`updash.token`, `updash.user`, `updash.clientId`); a global QueryClient `onError` triggers logout on 401. Pages: `/login`, `/dashboard`, `/funnel`, `/customers`, `/products`, `/sellers`, `/geography`, `/clients` (admin only). Date-range filter defaults to last 30 days. Admin users auto-pick the first client on load (analytics endpoints require a `clientId`); CLIENT users have a fixed `clientId` from JWT and don't see the picker.
- **Generated hooks gotcha**: orval-generated React Query hooks type the `query` option as `UseQueryOptions<...>` which (in TanStack Query v5) requires `queryKey`. The runtime fills it in via the generated `getXyzQueryKey()` helper, so consumers wrap their option object in `queryOpts({ ... })` from `src/lib/query-opts.ts` to satisfy the typing.
- **`GET /clients/:clientId` access**: ADMIN can read any client; CLIENT can read only their own (used by the topbar to show the brand name).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
