import { organizationFixture } from "./organization-fixtures.mjs";
// Isolated visual preview. Fixtures never contact production or extraction APIs.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = Number(process.env.DESIGN_API_PORT || 4174);
const uiPort = Number(process.env.DESIGN_UI_PORT || 4173);
const now = new Date().toISOString();
const user = {
  id: "design-admin",
  email: "demo@updash.local",
  firstName: "Time",
  lastName: "Grupo UP",
  role: "ADMIN",
  clientId: null,
};
const clients = ["B2B", "B2C"].map((mode) => ({
  id: `design-${mode.toLowerCase()}`,
  name:
    mode === "B2B" ? "Ateliê UP · Demonstração" : "Studio UP · Demonstração",
  email: "demo@updash.local",
  apiKey: "",
  revenueYtd: 842360,
  ordersYtd: 1284,
  leadsYtd: 3280,
  approvedLeads: 2150,
  isActive: true,
  dashboardType: mode,
  commercePlatform: mode === "B2B" ? "UPZERO" : "NUVEMSHOP",
  currency: "BRL",
  locale: "pt-BR",
  hiddenNavItems: [],
  hasNuvemshopIntegration: mode === "B2C",
  hasGa4Integration: true,
  createdAt: now,
  updatedAt: now,
}));
const productNames = [
  "Vestido Aurora",
  "Conjunto Serena",
  "Blusa Essencial",
  "Calça Alfaiataria",
  "Camisa Linho",
];
const products = productNames.map((name, i) => ({
  id: `product-${i}`,
  sku: `UP-2026-0${i + 1}`,
  name,
  category: ["Vestidos", "Conjuntos", "Blusas", "Calças", "Camisas"][i],
  price: 159 + i * 20,
  cost: 68,
  stock: i === 0 ? 4 : 88 + i * 12,
  restockThreshold: 10,
  totalSold: 280 - i * 35,
  totalRevenue: 48500 - i * 6500,
  productViews: 4500 - i * 450,
  productConversionPct: 4.8,
  status: "ACTIVE",
  imageUrl: null,
  percentSold: 0.68,
  level: i === 0 ? "At Risk" : "High Conversion",
  createdAt: now,
  gradeStatus: i === 0 ? "broken" : "complete",
  variantCount: 4,
  availableVariantCount: i === 0 ? 2 : 4,
  variants: ["P", "M", "G", "GG"].map((size, index) => ({
    id: `variant-${i}-${index}`,productId: `variant-${i}-${index}`,sku: `UP-2026-0${i+1}-${size}`,name: `${name} · ${size}`,
    color: "Preto",size,stock: i===0 ? (index<2?2:0) : (88+i*12)/4,price:159+i*20,
    totalSold:42+index*7,totalRevenue:(42+index*7)*(159+i*20),imageUrl:null,
  })),
}));
const sellers = ["Mariana Costa", "Ana Oliveira", "Camila Santos"].map(
  (name, i) => ({
    id: `seller-${i}`,
    name,
    email: `vendedora${i}@example.com`,
    totalOrders: 184 - 30 * i,
    totalRevenue: 97600 - 16000 * i,
    avgTicket: 530.43,
  }),
);
const customers = [
  "Loja Aurora",
  "Bella Moda",
  "Ateliê Serena",
  "Essência Boutique",
].map((name, i) => ({
  id: `customer-${i}`,
  clientId: clients[0].id,
  name,
  email: `loja${i}@example.com`,
  phone: null,
  documentType: "CNPJ",
  state: ["SP", "MG", "RJ", "PR"][i],
  city: ["São Paulo", "Belo Horizonte", "Rio de Janeiro", "Curitiba"][i],
  registrationStatus: "APPROVED",
  approvalDate: now,
  rfmSegment: "Champions",
  recencyScore: 5,
  frequencyScore: 5,
  monetaryScore: 5,
  totalOrders: 12 + i,
  totalSpent: 12500 + i * 1700,
  opportunityLevel: "HIGH",
  createdAt: now,
  firstPurchaseAt: now,
  lastPurchaseAt: now,
  utmSource: "instagram",
  utmMedium: "paid_social",
  utmCampaign: "Coleção Primavera",
}));
const states = ["SP", "MG", "RJ", "PR", "SC"].map((state, i) => ({
  state,
  orders: 380 - i * 55,
  revenue: 182400 - i * 23000,
  customers: 240 - i * 25,
}));
const series = (url, base) => {
  const from =
    url.searchParams.get("dateFrom") ||
    new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = url.searchParams.get("dateTo") || now.slice(0, 10);
  const start = new Date(from + "T12:00:00Z");
  const count = Math.max(
    1,
    Math.min(
      366,
      Math.round((new Date(to + "T12:00:00Z") - start) / 86400000) + 1,
    ),
  );
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(+start + i * 86400000).toISOString().slice(0, 10),
    value: Math.round(
      base * (1 + Math.sin(i * 0.55) * 0.2 + (i / count) * 0.45),
    ),
  }));
};
const dashboard = (url) => {
  const factor = url.searchParams.get("category") ? 0.65 : 1;
  const revenueOverTime = series(url, 8200 * factor);
  const ordersOverTime = series(url, 23 * factor);
  const revenue = revenueOverTime.reduce((sum, row) => sum + row.value, 0);
  const orders = ordersOverTime.reduce((sum, row) => sum + row.value, 0);
  const kpis = {
    revenue,
    orders,
    avgTicket: revenue / orders,
    conversionRate: 3.42,
    approvalRate: 72.8,
    leads: 2380,
    approvedLeads: 1732,
    customers: 512,
    repeatCustomers: 186,
    requestedRevenue: revenue * 1.2,
    newBuyers: 326,
    returningBuyers: 186,
    retentionPct: 36.32,
  };
  return {
    kpis,
    prevKpis: {
      ...kpis,
      revenue: revenue / 1.184,
      orders: Math.round(orders / 1.123),
      avgTicket: kpis.avgTicket / 1.054,
      conversionRate: 3.06,
      retentionPct: 32.7,
    },
    revenueOverTime,
    ordersOverTime,
    leadsOverTime: series(url, 65),
    newBuyersOverTime: series(url, 9),
    returningBuyersOverTime: series(url, 5),
    prevRevenueOverTime: revenueOverTime.map((row) => ({
      ...row,
      value: Math.round(row.value * 0.82),
    })),
    prevOrdersOverTime: ordersOverTime.map((row) => ({
      ...row,
      value: Math.round(row.value * 0.85),
    })),
    revenueByCategory: products.map((p) => ({
      category: p.category,
      revenue: p.totalRevenue,
      orders: p.totalSold,
    })),
    salesByCategory: products.map((p) => ({
      name: p.category,
      revenue: p.totalRevenue,
      units: p.totalSold,
      orders: p.totalSold,
    })),
    salesByColor: ["Preto", "Off-white", "Azul"].map((name, i) => ({
      name,
      revenue: 78000 - i * 19000,
      units: 310 - i * 45,
      orders: 210 - i * 30,
    })),
    salesBySize: ["P", "M", "G", "GG"].map((name, i) => ({
      name,
      revenue: 59000 - i * 10000,
      units: 260 - i * 30,
      orders: 175 - i * 20,
    })),
    traffic: { sessions: Math.round(orders / 0.0342), orders, source: "ga4" },
    dailyPerformance: revenueOverTime.map((row, i) => ({
      date: row.date,
      revenue: row.value,
      orders: ordersOverTime[i].value,
      sessions: 760 + i * 12,
      conversionRate: 3.42,
    })),
    signals: [
      {
        type: "high_performing_regions",
        severity: "info",
        title: "Sudeste lidera o crescimento",
        body: "Exemplo visual: São Paulo concentra a maior participação nas vendas do período.",
      },
    ],
  };
};
const insight = {
  headline: "Crescimento com espaço para avançar",
  body: "Exemplo de análise: o faturamento cresceu 18,4% no período. A coleção Primavera concentra o maior volume de pedidos.",
  bullets: [
    "Acompanhe a reposição dos produtos com maior saída.",
    "Explore as regiões com maior recorrência.",
  ],
  generatedAt: now,
  cached: true,
  source: "heuristic",
};
const alerts = {
  alerts: [
    {
      ...products[0],
      productId: products[0].id,
      averageDailySales: 3.2,
      daysOfCover: 1.3,
      type: "LOW_STOCK",
      severity: "warning",
      message: "Estoque próximo do limite de reposição.",
    },
  ],
  counts: {
    total: 1,
    critical: 0,
    warning: 1,
    outOfStock: 0,
    lowStock: 1,
    predictedStockout: 0,
  },
  horizonDays: 14,
  lookbackDays: 30,
};
const ordersResponse = (url) => ({
  period: {
    from: url.searchParams.get("dateFrom"),
    to: url.searchParams.get("dateTo"),
  },
  kpis: {
    requestedRevenue: 342890,
    fulfilledRevenue: 298240,
    requestedQuantity: 1840,
    fulfilledQuantity: 1654,
    fulfilledPct: 89.9,
    orders: 842,
    newCustomers: 326,
    returningCustomers: 186,
    retentionPct: 36.32,
    conversionPct: 3.42,
    approvedLeads: 1732,
    sessions: 24520,
  },
  rows: customers.map((c, i) => ({
    id: `order-${i}`,
    externalId: `UP-${10240 + i}`,
    status: "PAID",
    amount: 2480 + i * 340,
    fulfilledAmount: 2480 + i * 340,
    grossAmount: 2550 + i * 340,
    discountAmount: 70,
    shippingAmount: 0,
    requestedQuantity: 18 + i,
    fulfilledQuantity: 18 + i,
    approvalDate: now,
    createdAt: now,
    customerId: c.id,
    customerExternalId: null,
    customerName: c.name,
    customerEmail: c.email,
    customerPhone: null,
    documentType: c.documentType,
    document: null,
    state: c.state,
    city: c.city,
    refundStatusUnverified: null,
    origin: {
      source: "instagram",
      medium: "paid_social",
      campaign: "Primavera",
      label: "Instagram · Primavera",
      attribution: "tracking",
    },
  })),
  page: 1,
  limit: 50,
  total: 4,
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${apiPort}`);
  const path = url.pathname;
  if (path === "/ui-kit") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      readFileSync(resolve(root, "design-reference/up-glass-ui-kit.html")),
    );
    return;
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  const send = (data) => res.end(JSON.stringify(data));
  if (path === "/api/auth/login" && req.method === "POST") {
    send({
      accessToken: "design-preview-local",
      refreshToken: "design-preview-refresh",
      user,
    });
    return;
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    send({ message: "A prévia visual permite somente leitura." });
    return;
  }
  if (path === "/api/auth/me") return send(user);
  if (path === "/api/healthz") return send({ status: "ok" });
  if (path === "/api/clients")
    return send({ data: clients, total: 2, page: 1, pages: 1 });
  if (path.startsWith("/api/clients/"))
    return send(clients.find((c) => path.endsWith(c.id)) || clients[0]);
  if (path === "/api/analytics/dashboard") return send(dashboard(url));
  const organizedData = organizationFixture(path, url, dashboard(url), products, customers, sellers, now);
  if (organizedData !== undefined) return send(organizedData);
  if (path === "/api/analytics/insight") return send(insight);
  if (path === "/api/analytics/alerts") return send(alerts);
  if (path === "/api/analytics/sellers") return send(sellers);
  if (path === "/api/analytics/products")
    return send(
      products.filter(
        (p) =>
          !url.searchParams.get("search") ||
          p.name
            .toLowerCase()
            .includes(url.searchParams.get("search").toLowerCase()),
      ),
    );
  if (path === "/api/analytics/products/summary")
    return send({
      availableStockSalesValue: products.reduce((sum, p) => sum + Math.max(0, p.stock) * p.price, 0),
      salesPower: 860.45,
      prevSalesPower: 744.8,
      salesPowerChangePct: 15.52,
      activeSkus: 5,
      periodDays: 30,
    });
  if (path === "/api/analytics/customers")
    return send({
      data: customers,
      total: 4,
      page: 1,
      pages: 1,
      segmentCounts: [{ segment: "Champions", count: 4 }],
    });
  if (path === "/api/analytics/customers/summary")
    return send({
      kpis: {
        totalRegistrations: 2380,
        approvedRegistrations: 1732,
        approvalRate: 72.8,
        newCustomers: 326,
        returningCustomers: 186,
        revenueFromNewCustomers: 182000,
        revenueFromReturningCustomers: 116240,
        avgTimeToApprovalHours: 2.4,
      },
      registrationsOverTime: series(url, 65),
      sourceBreakdown: [],
      stateBreakdown: [],
    });
  if (path === "/api/analytics/geography")
    return send({
      states,
      cities: customers.map((c, i) => ({
        state: c.state,
        city: c.city,
        revenue: 65000 - i * 9000,
        orders: 120 - i * 15,
      })),
    });
  if (path === "/api/analytics/funnel")
    return send({
      steps: [
        {
          step: "visit",
          label: "Visitas",
          count: 24520,
          conversionRate: 100,
          dropOffRate: 0,
        },
        {
          step: "register",
          label: "Cadastros",
          count: 2380,
          conversionRate: 9.7,
          dropOffRate: 90.3,
        },
        {
          step: "approved",
          label: "Aprovados",
          count: 1732,
          conversionRate: 72.8,
          dropOffRate: 27.2,
        },
        {
          step: "purchase",
          label: "Compras",
          count: 842,
          conversionRate: 48.6,
          dropOffRate: 51.4,
        },
      ],
      overallConversion: 3.42,
      insights: ["Dados ilustrativos da demonstração."],
      avgEventsBeforePurchase: 4.8,
      topPaths: [],
      suggestedActions: [],
      hasSiteVisitData: true,
    });
  if (path === "/api/analytics/b2c/orders")
    return send({
      ...ordersResponse(url),
      rows: ordersResponse(url).rows.map((row) => ({
        ...row,
        status: "APPROVED",
        refundedAmount: 0,
        cancelledAmount: 0,
      })),
    });
  if (path === "/api/analytics/orders-page") return send(ordersResponse(url));
  if (path === "/api/analytics/orders")
    return send({
      date: url.searchParams.get("date"),
      totalOrders: 4,
      totalRevenue: 11960,
      orders: ordersResponse(url).rows,
    });
  if (path === "/api/analytics/campaign-customers")
    return send({
      rows: [],
      summary: {
        impactedCustomers: 0,
        attributedRevenue: 0,
        requestedValue: 0,
        fulfilledValue: 0,
        investment: 0,
        roas: 0,
        orders: 0,
        itemQuantity: 0,
        registrations: 0,
      },
      total: 0,
    });
  if (path === "/api/notifications")
    return send({ data: [], total: 0, unreadCount: 0 });
  if (path === "/api/saved-views") return send([]);
  res.statusCode = 503;
  send({
    message:
      "Esta integração exige o backend real. A prévia usa apenas dados de demonstração.",
  });
});
server.listen(apiPort, "127.0.0.1", () => {
  console.log(
    `Prévia visual: http://localhost:${uiPort} (dados fictícios; API local somente leitura)`,
  );
});
const vite = spawn(
  process.execPath,
  [
    "artifacts/up-dash/node_modules/vite/bin/vite.js",
    "--config",
    "artifacts/up-dash/vite.config.ts",
    "--host",
    "127.0.0.1",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(uiPort),
      BASE_PATH: "/",
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_DESIGN_DEMO: "1",
    },
  },
);
const stop = () => {
  vite.kill("SIGTERM");
  server.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", () => server.close());
