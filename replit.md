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
- A global filter bar supports 13 filters across two tiers: core filters (channel, segment, category, seller) always visible in the bar, plus 9 advanced filters (UTM Source, UTM Medium, UTM Campaign, State, City, Product, Size, Color, Creative) accessible via a "More filters" popover grouped into Attribution, Geography, and Catalog sections. Supports save and load named views for all 13 keys.
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
- **Product Detail page (Task #30, final):** Products list enriched with: thumbnail avatar (32×32 image or initials fallback), Level badge (High Conversion/Standard/Low/At Risk derived from improved sell-through + stock-health heuristic — never-sold → At Risk), % Sold progress bar, Created At date, and row-click navigation to detail page. `GET /analytics/products/summary` returns Sales Power KPI (avg revenue per active SKU per day, period vs prior, active SKU count). `GET /analytics/products/{productId}` returns full profile: **lifetime** KPIs (revenue, units sold, avg ticket, unique buyers — no date filter), revenue-over-time with prev-period overlay (period-scoped line chart), breakdowns by color, size, and state. `GET /analytics/products/{productId}/customers` returns paginated buyer list. Products page has a 4-tile Sales Power KPI strip + AI insight card (screen=products). Product Detail page uses `<EmptyState>` for all empty states (product-not-found, chart empty, buyers empty, breakdown empty). Search palette product results navigate to `/products/:id` (not `?search=`). Unused variables (revenueChartData, prevMap) removed from product-detail.tsx.
- **AI Insight Screens:** `/analytics/insight?screen=dashboard|marketing|customers|products|journey|rfm` — six distinct prompt contexts: dashboard (revenue/orders/conversion KPIs), marketing (ROAS/spend/leads), customers (registrations/approval rate/buyers), products (top SKUs, level distribution, at-risk/high-conversion counts), journey (avg events before purchase, top paths), rfm (segment distribution, champion revenue). Each returns headline + body + 3 bullets, with heuristic fallback when AI is not configured. Insight is cached 1h per (clientId, dateWindow, screen) key.
- **Journey Analytics page (Task #33):** `/journey` — KPI strip (avg events before purchase, avg time to first purchase, avg time between purchases, % buyers from first session), SVG event-flow graph (layered node-and-edge diagram), top-5 paths to purchase (steps + conversion rate + visit count), buyers vs non-buyers event comparison bar chart, AI insight banner. Backend uses raw SQL for all `AVG(COUNT(*))` subqueries (Drizzle v0.45 subquery alias workaround).
- **RFM Segmentation page (Task #33):** `/rfm` — 5 clickable segment cards (Champions/Loyal/Promising/At Risk/Lost) with customer count + revenue, stacked area chart for segment composition over time, paginated/sortable customer table (name, email, segment badge, recency days, frequency, monetary), AI insight banner. Segment filter syncs with both the cards and the table dropdown.
- **UTM / Source Analysis page (Task #34):** `/utm` — 6-card KPI strip (total revenue, orders, ROAS, conversion rate, unique sources, avg order value), source/campaign tab switcher, two horizontal bar charts (Revenue by Source/Campaign, Conversion % by Source/Campaign), sortable collapsible table with medium sub-rows (key, revenue, orders, conv%, ROAS, customers, new buyers), AI insight banner. Sidebar nav entry "UTM" with link icon. Global filter bar expanded to 9 new advanced filters in "More filters" popover (Attribution: UTM Source, UTM Medium, UTM Campaign; Geography: State, City; Catalog: Product, Size, Color, Creative). New filter params wired into `/analytics/dashboard` (utmSource, utmMedium, utmCampaign applied to `scopedCustomerIds`) and `/analytics/customers` (utmSource, utmMedium SQL WHERE conditions). OpenAPI spec updated with new params on both endpoints; codegen re-run.
- **Funnel enhancements (Task #33):** KPI strip expanded to 4 tiles (total visits, purchases, biggest drop, avg events before purchase). Insights sidebar now includes "Common paths to purchase" mini-list with link to Journey page, and "Suggested actions" generated from the worst drop-off step.
- **Site Visit Data (Task #77):** A `site_visits` table stores daily website visit counts per client (client_id, visit_date, visit_count — unique per client+date). Admins can enter daily visit counts via a "Site Visits" dialog on the Clients page (each client row). The funnel `GET /analytics/funnel` endpoint overlays visit data from this table into the VISIT step — when real data exists, the step shows meaningful numbers and the "About this data" notice is hidden. `POST /api/analytics/site-visits` (admin-only) upserts rows; `GET /api/analytics/site-visits` returns rows for a date range. OpenAPI spec updated; React Query hooks regenerated.
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