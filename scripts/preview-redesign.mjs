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
const clients = ["B2B", "B2C", "B2C", "B2C", "B2C"].map((mode, index) => ({
  id: index < 2 ? `design-${mode.toLowerCase()}` : `design-brand-${index}`,
  name:
    index === 0 ? "Ateliê UP · Demonstração" : ["", "Studio UP", "Aurora", "Serena", "Origem"][index] + " · Demonstração",
  email: "demo@updash.local",
  apiKey: "",
  revenueYtd: 842360,
  ordersYtd: 1284,
  leadsYtd: 3280,
  approvedLeads: 2150,
  isActive: true,
  hasClientLogin: true,
  clientLoginCount: index === 1 ? 2 : 1,
  clientLoginEmail: `equipe${index + 1}@updash.local`,
  clientLoginName: "Equipe Demonstração",
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
    color: ["Preto", "Off-white", "Azul", "Verde"][(i+index)%4],size,stock: i===0 ? (index<2?2:0) : (88+i*12)/4,price:159+i*20,
    totalSold: index < 3 ? Math.floor((280-i*35)*[0.15,0.35,0.3][index]) : (280-i*35)-[0.15,0.35,0.3].reduce((sum,weight)=>sum+Math.floor((280-i*35)*weight),0),
    totalRevenue: (48500-i*6500)*(index < 3 ? Math.floor((280-i*35)*[0.15,0.35,0.3][index]) : (280-i*35)-[0.15,0.35,0.3].reduce((sum,weight)=>sum+Math.floor((280-i*35)*weight),0))/(280-i*35),imageUrl:null,
  })),
}));
// Synthetic sales stay reconciled across dimensions and react to report filters.
function filteredDemoProducts(url) {
  const params = url.searchParams;
  const from = params.get("dateFrom"), to = params.get("dateTo");
  const days = from && to ? Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1) : 30;
  const factor = Math.min(1, days/30);
  const search = (params.get("search") || params.get("sku") || "").toLowerCase();
  const selected = products.filter((product, index) =>
    (!search || `${product.name} ${product.sku}`.toLowerCase().includes(search)) &&
    (!params.get("category") || product.category === params.get("category")) &&
    (!params.get("state") || ["SP","MG","RJ","PR","SP"][index] === params.get("state"))
  );
  return selected.map(product => {
    const variants = product.variants.filter(variant =>
      (!params.get("color") || variant.color.toLowerCase() === params.get("color").toLowerCase()) &&
      (!params.get("size") || variant.size.toLowerCase() === params.get("size").toLowerCase())
    ).map(variant => {
      const totalSold = Math.round(variant.totalSold*factor);
      return { ...variant, totalSold, totalRevenue: variant.totalSold ? variant.totalRevenue*totalSold/variant.totalSold : 0 };
    });
    return { ...product, variants, totalSold: variants.reduce((sum,row)=>sum+row.totalSold,0), totalRevenue: variants.reduce((sum,row)=>sum+row.totalRevenue,0) };
  }).filter(product => product.variants.length > 0);
}
function demoProductSalesBreakdowns(url) {
  const categories = new Map(), colors = new Map(), sizes = new Map();
  const totals = { units: 0, revenue: 0 };
  const add = (map, label, variant) => {
    const bucket = map.get(label) || { label, units: 0, revenue: 0 };
    bucket.units += variant.totalSold;
    bucket.revenue += variant.totalRevenue;
    map.set(label,bucket);
  };
  for (const product of filteredDemoProducts(url)) for (const variant of product.variants) {
    totals.units += variant.totalSold;
    totals.revenue += variant.totalRevenue;
    add(categories,product.category,variant);
    add(colors,variant.color,variant);
    add(sizes,variant.size,variant);
  }
  return { totals, categories: [...categories.values()], colors: [...colors.values()], sizes: [...sizes.values()] };
}
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
  const brandFactor = ({ "design-brand-2": 0.84, "design-brand-3": 1.12, "design-brand-4": 0.67 })[url.searchParams.get("clientId")] ?? 1;
  const factor = (url.searchParams.get("category") ? 0.65 : 1) * brandFactor;
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
// Full-dashboard synthetic views. These fixtures contain no credentials and never perform writes.
const demoAccesses = clients.flatMap((client, index) => Array.from({ length: client.clientLoginCount }, (_, slot) => ({
  id: `demo-access-${index}-${slot}`, userId: `demo-user-${index}-${slot}`, email: slot === 0 ? client.clientLoginEmail : `comercial${index}@updash.local`,
  firstName: slot === 0 ? "Equipe" : "Comercial", lastName: ["Ateliê", "Studio", "Aurora", "Serena", "Origem"][index],
  role: "CLIENT", clientId: client.id, clientName: client.name, createdAt: now, updatedAt: now,
})));
function demoClientList(url) {
  const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("pt-BR");
  const type = url.searchParams.get("dashboardType");
  const rows = clients.filter(c => (!type || c.dashboardType === type) && (!search || `${c.name} ${c.email}`.toLocaleLowerCase("pt-BR").includes(search))).map(c => {
    const scoped = new URL(url); scoped.searchParams.set("clientId", c.id);
    const { kpis, prevKpis, traffic } = dashboard(scoped);
    return { ...c, revenueYtd: kpis.revenue, ordersYtd: kpis.orders, avgOrderValue: kpis.avgTicket, conversionRate: kpis.conversionRate,
      periodGrowthPct: (kpis.revenue / prevKpis.revenue - 1) * 100, periodRoas: 10.74, periodLeads: c.dashboardType === "B2C" ? kpis.orders : kpis.leads,
      periodApprovalRate: c.dashboardType === "B2C" ? traffic.sessions : kpis.approvalRate };
  });
  const page = Math.max(1, Number(url.searchParams.get("page") || 1)), limit = Math.max(1, Number(url.searchParams.get("limit") || 20));
  return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)), limit };
}
function demoReportPeriod(url) {
  const from = url.searchParams.get("dateFrom") || now.slice(0, 10), to = url.searchParams.get("dateTo") || from;
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const previousTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const previousFrom = new Date(new Date(from).getTime() - days * 86400000).toISOString().slice(0, 10);
  return { from, to, days, previousFrom, previousTo };
}
function demoDailyReport(url) {
  const d = dashboard(url), period = demoReportPeriod(url), breakdown = demoProductSalesBreakdowns(url);
  const client = clients.find(c => c.id === url.searchParams.get("clientId")) || clients[1];
  const spend = Math.round(d.kpis.revenue / 10.74), previousSpend = Math.round(spend / 1.06);
  const metrics = (k, mediaSpend) => ({ approvedRevenue: k.revenue, sales: k.orders, avgTicket: k.orders ? k.revenue / k.orders : 0, mediaSpend, costPerPurchase: k.orders ? mediaSpend / k.orders : 0, roas: mediaSpend ? k.revenue / mediaSpend : 0 });
  const kpis = metrics(d.kpis, spend), prevKpis = metrics(d.prevKpis, previousSpend);
  return { client: { id: client.id, name: client.name }, period: { from: period.from, to: period.to }, previousPeriod: { from: period.previousFrom, to: period.previousTo }, kpis, prevKpis,
    changes: Object.fromEntries(Object.keys(kpis).map(key => [key, prevKpis[key] ? (kpis[key] / prevKpis[key] - 1) * 100 : null])),
    campaigns: ["Coleção Primavera", "Remarketing · Catálogo", "Novos clientes"].map((name, i) => { const weight = [0.5, 0.3, 0.2][i], campaignSpend = spend * weight, purchases = Math.round(kpis.sales * weight), revenue = kpis.approvedRevenue * weight; return { id: `demo-campaign-${i}`, name, spend: campaignSpend, purchases, revenue, roas: campaignSpend ? revenue / campaignSpend : 0, cpa: purchases ? campaignSpend / purchases : 0, clicks: purchases * 24, impressions: purchases * 1300 }; }),
    products: filteredDemoProducts(url).map(p => ({ name: p.name, category: p.category, units: p.totalSold, revenue: p.totalRevenue })),
    categories: breakdown.categories.map(r => ({ name: r.label, units: r.units, revenue: r.revenue })), colors: breakdown.colors.map(r => ({ name: r.label, units: r.units, revenue: r.revenue })), sizes: breakdown.sizes.map(r => ({ name: r.label, units: r.units, revenue: r.revenue })),
    analysis: { source: "heuristic", generalAnalysis: "Nesta demonstração, a receita e a quantidade de pedidos avançam em relação ao período anterior. Acompanhe a reposição das peças mais vendidas e o custo por compra antes de aumentar o investimento.", reportSummary: ["Compare faturamento, pedidos e ticket médio na mesma janela de datas.", "Priorize a reposição de tamanhos com maior saída e estoque baixo.", "Acompanhe o retorno de cada campanha ao ajustar o orçamento de mídia."] }, generatedAt: now };
}
function demoScale(url) {
  const d = dashboard(url).kpis, period = demoReportPeriod(url), rows = filteredDemoProducts(url), breakdown = demoProductSalesBreakdowns(url);
  const client = clients.find(c => c.id === url.searchParams.get("clientId")) || clients[1];
  const currentSalesPower = products.reduce((sum, p) => sum + p.variants.reduce((value, v) => value + v.stock * v.price, 0), 0);
  const availableStockUnits = products.reduce((sum, p) => sum + p.stock, 0);
  const monthlyRevenue = d.revenue / period.days * 30, monthlyOrders = d.orders / period.days * 30;
  const roas = 10.74, mediaSpend = d.revenue / roas, cpa = mediaSpend / d.orders, monthlyTurnoverPct = currentSalesPower ? monthlyRevenue / currentSalesPower * 100 : 0;
  const benchmarks = { windowDays: 90, from: new Date(new Date(period.to).getTime() - 89 * 86400000).toISOString().slice(0, 10), to: period.to, monthlyRevenue: monthlyRevenue / 1.08, monthlyOrders: monthlyOrders / 1.05, avgTicket: d.avgTicket / 1.03, monthlyTurnoverPct: monthlyTurnoverPct / 1.08, mediaSpend: monthlyRevenue / 1.08 / roas * 3, monthlyMediaSpend: monthlyRevenue / 1.08 / roas, roas, cpa, sessions: Math.round(d.orders / 0.0342), conversionRate: 3.42 };
  const targetRevenue = Number(url.searchParams.get("targetRevenue")) > 0 ? Number(url.searchParams.get("targetRevenue")) : Math.round(monthlyRevenue * 1.3);
  const requiredSalesPower = benchmarks.monthlyTurnoverPct ? targetRevenue / (benchmarks.monthlyTurnoverPct / 100) : 0;
  const projection = { targetRevenue, simulatedSalesPower: currentSalesPower, requiredSalesPower, projectedRevenue: targetRevenue, projectedMediaSpend: targetRevenue / benchmarks.roas, projectedOrders: targetRevenue / benchmarks.avgTicket, projectedCpa: benchmarks.avgTicket / benchmarks.roas,
    revenueIncrement: Math.max(0, targetRevenue - monthlyRevenue), mediaSpendIncrement: Math.max(0, targetRevenue / benchmarks.roas - mediaSpend / period.days * 30), salesPowerGap: Math.max(0, requiredSalesPower - currentSalesPower), status: requiredSalesPower > currentSalesPower ? "caution" : "ready",
    scenarios: [0.9, 1, 1.15].map((factor, i) => ({ name: ["Conservador", "Meta planejada", "Expansão"][i], salesPower: requiredSalesPower * factor, revenue: targetRevenue * factor, mediaSpend: targetRevenue * factor / benchmarks.roas, orders: targetRevenue * factor / benchmarks.avgTicket })) };
  const mapRows = list => list.map(r => ({ name: r.label, revenue: r.revenue, units: r.units, orders: Math.round(r.units / 1.5) })).sort((a, b) => b.revenue - a.revenue);
  return { client: { id: client.id, name: client.name }, period: { from: period.from, to: period.to, days: period.days },
    kpis: { currentSalesPower, revenue: d.revenue, orders: d.orders, availableStockUnits, activeProducts: products.length, availableProducts: products.filter(p => p.stock > 0).length, periodTurnoverPct: currentSalesPower ? d.revenue / currentSalesPower * 100 : 0, monthlyRevenue, monthlyOrders, avgTicket: d.avgTicket, monthlyTurnoverPct, mediaSpend, monthlyMediaSpend: mediaSpend / period.days * 30, roas, cpa, sessions: Math.round(d.orders / 0.0342), conversionRate: 3.42, brokenGradePct: 20, brokenGradeCount: 1, productGroupCount: products.length }, benchmarks, projection,
    breakdowns: { categories: mapRows(breakdown.categories), colors: mapRows(breakdown.colors), sizes: mapRows(breakdown.sizes), stockByCategory: products.map(p => ({ name: p.category, revenue: 0, units: 0, stockUnits: p.stock, salesPower: p.variants.reduce((sum, v) => sum + v.stock * v.price, 0) })) },
    insights: { headline: "Prepare o estoque para o próximo patamar", summary: "Esta simulação usa o ritmo de vendas e as referências de giro, ticket médio e ROAS da marca. As projeções são estimativas e dependem de disponibilidade e demanda.", actions: ["Reponha tamanhos com estoque baixo antes de ampliar a mídia.", "Ajuste o faturamento alvo na calculadora e acompanhe o estoque adicional.", "Acompanhe o custo por compra à medida que aumentar o investimento."], risks: ["Grade incompleta pode limitar a conversão.", "O desempenho passado não garante a receita projetada."], source: "heuristic" }, generatedAt: now };
}

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
    return send(demoClientList(url));
  if (/^\/api\/clients\/[^/]+$/.test(path))
    return send(clients.find((c) => path.endsWith(c.id)) || clients[0]);
  if (path === "/api/accesses") return send({ data: demoAccesses });
  if (path === "/api/analytics/daily-report") return send(demoDailyReport(url));
  if (path === "/api/analytics/scale") return send(demoScale(url));
  if (path === "/api/analytics/dashboard") return send(dashboard(url));
  const organizedData = organizationFixture(path, url, dashboard(url), products, customers, sellers, now);
  if (organizedData !== undefined) return send(organizedData);
  if (path === "/api/analytics/insight") return send(insight);
  if (path === "/api/analytics/alerts") return send(alerts);
  if (path === "/api/analytics/sellers") return send(sellers);
  if (path === "/api/analytics/products/sales-breakdowns") return send(demoProductSalesBreakdowns(url));
  if (path === "/api/analytics/products") {
    const sort = url.searchParams.get("sort");
    const rows = filteredDemoProducts(url).sort((a,b) => sort === "units" ? b.totalSold-a.totalSold : b.totalRevenue-a.totalRevenue);
    return send(rows.slice(0, Number(url.searchParams.get("limit") || 50)));
  }
  if (path === "/api/analytics/products/summary") {
    const rows = filteredDemoProducts(url);
    const from = url.searchParams.get("dateFrom"), to = url.searchParams.get("dateTo");
    const periodDays = from && to ? Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1) : 30;
    const activeSkus = rows.reduce((sum, product) => sum + product.variants.filter(variant => variant.totalSold > 0).length, 0);
    const revenue = rows.reduce((sum, product) => sum+product.totalRevenue, 0);
    const salesPower = activeSkus > 0 ? revenue/activeSkus/periodDays : 0;
    return send({
      availableStockSalesValue: products.reduce((sum, p) => sum + Math.max(0, p.stock) * p.price, 0),
      salesPower,
      prevSalesPower: salesPower,
      salesPowerChangePct: 0,
      activeSkus,
      periodDays,
    });
  }
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
