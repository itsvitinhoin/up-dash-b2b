# UP Dash

## Overview

UP Dash is a B2B fashion-industry e-commerce analytics platform designed for multi-tenant oversight by administrators and private dashboards for individual brand owners. It offers comprehensive insights into revenue, conversion funnels, customer RFM segmentation, product/seller performance, and geographic distribution. The platform aims to provide actionable intelligence to improve e-commerce operations for fashion brands.

## User Preferences

No specific user preferences were provided in the original `replit.md` file.

## System Architecture

The project is a pnpm monorepo. The architecture is composed of a Node.js backend (Express.js, Drizzle ORM, JWT authentication) and a React frontend (`artifacts/up-dash`) served from `/up-dash`. Shared schemas, OpenAPI specifications, and generated React Query hooks reside in the `lib/` directory.

**UI/UX Decisions:**
- The frontend uses React with Vite, TanStack Query, shadcn/ui, and Recharts.
- KPI cards feature animated numbers (CountUp) and inline sparklines.
- AI-powered insight cards provide context-specific analytics.
- A drill-down panel allows detailed order-level analysis from charts.
- A notification center synthesizes and displays anomaly signals.
- A global filter bar supports channel, segment, category, and seller filters, with the ability to save and load named views.
- Keyboard shortcuts enhance navigation and user interaction.
- Page transitions are animated using `framer-motion`.
- Consistent empty states are provided across all data-empty views.
- The login page features a dark gradient, animated grid background, drifting blurred orbs, glassmorphic auth card, and live KPI tiles.
- The conversion funnel page includes an animated SVG radial conversion ring and a bespoke SVG funnel diagram.
- The geography page features a custom SVG Brazil heat map with interactive elements, leaderboards, and a state/city toggle table.

**Technical Implementations:**
- **Authentication:** JWT with a 1-hour access token and 7-day opaque refresh token. Refresh tokens are single-use rotational. 401 responses trigger an automatic token refresh and retry mechanism.
- **Multi-tenancy:** Every domain table includes a `clientId`. The system enforces tenant scope, allowing admins to view all clients while client users are restricted to their own data.
- **API Codegen:** Orval is used to generate Zod schemas and React Query hooks from an OpenAPI spec.
- **Production Hardening:** Includes helmet for security, gzip compression, CORS allowlisting, two-tier rate limiting, pino for logging with redaction, and a `/healthz` endpoint for database connectivity checks.
- **Analytics Endpoints:** All analytics queries use real Drizzle SQL to provide KPIs, daily series, conversion funnels, RFM segmentation, product/seller rankings, geographic breakdowns, and marketing performance metrics (ad spend, ROAS, CPL, CPA, platform breakdown, creative metrics).
- **Per-client currency/locale:** The system supports dynamic currency and locale formatting based on the active client's settings.
- **AI Insight:** Leverages a Replit AI proxy to generate 3-bullet narrative insights based on KPIs, with caching and a heuristic fallback.
- **Inventory Alerts:** Provides real-time stock alerts (out of stock, predicted stockout, low stock) based on product stock levels and sales velocity.
- **Marketing KPIs (Task #28):** Platform Overview now shows a second row of tiles for Ad Spend, Global ROAS, Total Leads, and Approved Leads (with period-over-period deltas). The chart tab on Overview now includes a "Leads" series. The Clients table has three new columns: ROAS, Leads, and Approval Rate. The Dashboard has a second KPI row showing Requested vs Approved Revenue (with a fulfillment progress bar), New vs Returning Buyers breakdown, and Buyer Retention %; plus a Business Signals panel that surfaces computed signals (high_traffic_low_sales, high_performing_regions).
- **CRM Analytics (Task #29):** Customers page with 7-metric KPI strip (period-over-period delta badges), 3-tab chart card, server-side opportunityLevel, Campaign Attribution YES/NO badge, First Purchase + Last Purchase columns, and clickable rows. Customer Detail page at `/customers/:customerId` shows header card (with assigned seller derived from most recent order), attribution panel (channel/medium/campaign/status/approval date), Customer Journey funnel, Orders table (with Seller column), and Products table (with thumbnail, unit price, first order date). AI insight card on Customers page uses `screen=customers` context. computeSummaryKpis lifted to module scope for reuse in insight handler. Dashboard drill-down panel has clickable customer names navigating to customer detail. Search palette navigates to customer detail.
- **AI Insight Screens:** `/analytics/insight?screen=dashboard|marketing|customers` — three distinct prompt contexts: dashboard (revenue/orders/conversion KPIs), marketing (ROAS/spend/leads), customers (registrations/approval rate/buyers). Each returns headline + body + 3 bullets, with heuristic fallback when AI is not configured. Insight is cached 1h per (clientId, dateWindow, screen) key.
- **Data Export:** Per-page CSV export functionality for various tables and PDF export for the dashboard via `window.print()`.

## External Dependencies

- **Database:** PostgreSQL with Drizzle ORM.
- **Authentication:** `jsonwebtoken` for JWT, `bcryptjs` for password hashing.
- **Validation:** Zod (`zod/v4`) and `drizzle-zod`.
- **API Codegen:** Orval.
- **AI Integration:** OpenAI (via Replit AI proxy) for AI insights.
- **UI Components:** shadcn/ui.
- **Charting:** Recharts.
- **Animation:** `framer-motion`.
- **State Management/Data Fetching:** TanStack Query.
- **Routing:** wouter.