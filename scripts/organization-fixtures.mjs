// Local demonstration responses only. No production API or extraction is called.
export function organizationFixture(
  path,
  url,
  dashboard,
  products,
  customers,
  sellers,
  now,
) {
  const d = dashboard.kpis;
  const factor = d.revenue / 305038 || 1;
  const money = (value) => Math.round(value * factor);
  const days = dashboard.revenueOverTime;
  const spend = money(28400);
  const cohort = (faturamento, vendas, clientes) => ({
    faturamento: money(faturamento),
    vendas: Math.round(vendas * factor),
    clientes: Math.round(clientes * factor),
    ticketMedio: faturamento / vendas,
  });
  const blocks = {
    recompra: cohort(118240, 324, 186),
    recorrentes: cohort(92400, 248, 144),
    reativados: cohort(25840, 76, 42),
    ciclo: {
      tempoMedioDias: 42.6,
      medianaDias: 35,
      pctRecorrente: 77.4,
      pctReativado: 22.6,
    },
    intervalBuckets: [
      "7 dias",
      "30 dias",
      "60 dias",
      "90 dias",
      "180 dias",
      "+180 dias",
    ].map((faixa, index) => ({
      faixa,
      clientes: 18 + index * 7,
      grupo: index < 4 ? "recorrente" : "reativado",
    })),
    unmatchedErpCount: 0,
    attributionUnavailable: false,
  };
  const summary = {
    totalRegistrations: 2380,
    approvedRegistrations: 1732,
    pendingRegistrations: 510,
    rejectedRegistrations: 138,
    approvalRatePct: 72.8,
    customersWithoutPurchase: 890,
    totalBuyers: 842,
    avgTimeToFirstPurchaseDays: 8.6,
    avgTimeBetweenPurchasesDays: 42.6,
  };
  const prevSummary = Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [
      key,
      Math.round(value * 0.9 * 10) / 10,
    ]),
  );
  const creativeRows = products.map((product, index) => ({
    id: `ad-${index}`,
    name: `Primavera · ${product.name}`,
    platform: "META",
    status: "ACTIVE",
    imageUrl: null,
    clicks: 760 + index * 125,
    impressions: 47000 + index * 6100,
    ctr: 1.62,
    leads: 108 + index * 16,
    approvedLeads: 78 + index * 14,
    spend: money(1800 + index * 500),
    attributedRevenue: money(16000 + index * 3300),
    roas: 8.89,
    cpl: 16.67,
    cpa: 23.08,
  }));
  const metaCreatives = creativeRows.map((row) => ({
    ...row,
    purchases: row.approvedLeads,
    mediaType: "unknown",
    previewUrl: null,
    thumbnailUrl: null,
    videoUrl: null,
  }));
  const erpCustomers = customers.map((c, index) => ({
    ...c,
    company: c.name,
    document: null,
    seller: sellers[index % sellers.length].name,
    orders: 12 - index,
    totalSpent: money(14800 - index * 1400),
    historicalOrders: 24 - index,
    lifetimeValue: money(42000 - index * 2200),
    buyerType: index < 2 ? "NEW" : "RETURNING",
    segment: "Loyal",
    lastOrderAt: now,
    utmSource: "instagram",
    utmCampaign: "Primavera",
    attributed: true,
  }));
  const erpProducts = products.map((p) => ({
    ...p,
    units: p.totalSold,
    revenue: p.totalRevenue,
    turnoverPct: 68,
    salesPower: 860.45,
    grossProfit: p.totalRevenue * 0.4,
    grossMarginPct: 40,
    coverageDays: 24,
    variantCount: 4,
    avgPrice: p.price,
    avgCost: p.cost,
    variants: [],
  }));
  const erpOrders = customers.map((c, index) => ({
    id: `erp-order-${index}`,
    createdAt: now,
    customerId: c.id,
    customerName: c.name,
    company: c.name,
    document: null,
    seller: sellers[index % sellers.length].name,
    store: "Loja UP",
    paymentMethod: "PIX",
    freightAmount: 0,
    channel: "site",
    status: "FATURADO",
    requestedQuantity: 8,
    fulfilledQuantity: 8,
    returnedQuantity: 0,
    grossAmount: money(2480 + index * 340),
    discountAmount: 0,
    netAmount: money(2480 + index * 340),
    returnAmount: 0,
    state: c.state,
    city: c.city,
    utmSource: "instagram",
    utmMedium: "paid_social",
    utmCampaign: "Primavera",
    attributed: true,
    buyerType: index < 2 ? "NEW" : "RETURNING",
    items: [],
  }));
  const breakdown = [
    { label: "São Paulo", orders: 340, revenue: money(128600), customers: 198 },
    {
      label: "Minas Gerais",
      orders: 205,
      revenue: money(78120),
      customers: 120,
    },
    { label: "Paraná", orders: 148, revenue: money(56380), customers: 94 },
  ];
  const period = {
    from: url.searchParams.get("dateFrom"),
    to: url.searchParams.get("dateTo"),
  };
  if (path === "/api/analytics/customers/summary")
    return {
      kpis: summary,
      prevKpis: prevSummary,
      registrationsOverTime: days.map((p, index) => ({
        date: p.date,
        registrations: 50 + index * 3,
        approved: 36 + index * 2,
      })),
      registrationsByState: [
        { state: "SP", count: 890 },
        { state: "MG", count: 620 },
        { state: "PR", count: 420 },
      ],
      registrationsBySource: [
        { source: "Instagram", count: 1490 },
        { source: "Google", count: 890 },
      ],
    };
  if (path === "/api/analytics/marketing")
    return {
      kpis: {
        totalSpend: spend,
        attributedRevenue: d.requestedRevenue,
        roas: spend ? d.requestedRevenue / spend : 0,
        totalLeads: 2380,
        approvedLeads: 1732,
        approvalRate: 72.8,
        cpl: 11.93,
        cpa: 16.4,
      },
      prevKpis: {
        totalSpend: spend * 0.9,
        attributedRevenue: d.requestedRevenue * 0.82,
        roas: 10.2,
        totalLeads: 2150,
        approvedLeads: 1490,
        approvalRate: 69.3,
        cpl: 12.1,
        cpa: 17.7,
      },
      leadsOverTime: days.map((p, index) => ({
        date: p.date,
        value: 50 + index * 3,
      })),
      revenueOverTime: dashboard.revenueOverTime,
      spendOverTime: days.map((p, index) => ({
        date: p.date,
        value: Math.round(spend / days.length) + index * 2,
      })),
      creatives: creativeRows,
      creativesTotal: creativeRows.length,
      topCreatives: {
        ctr: metaCreatives,
        cpl: metaCreatives,
        leads: metaCreatives,
      },
      platformBreakdown: [
        {
          platform: "META",
          spend: spend * 0.78,
          leads: 1840,
          approvedLeads: 1332,
          clicks: 25180,
          impressions: 1240000,
          attributedRevenue: d.requestedRevenue * 0.78,
          roas: 12.89,
        },
        {
          platform: "GOOGLE",
          spend: spend * 0.22,
          leads: 540,
          approvedLeads: 400,
          clicks: 7100,
          impressions: 248000,
          attributedRevenue: d.requestedRevenue * 0.22,
          roas: 12.89,
        },
      ],
      stateBreakdown: [
        {
          state: "SP",
          leads: 890,
          attributedRevenue: money(128600),
          roas: 13.1,
        },
        {
          state: "MG",
          leads: 620,
          attributedRevenue: money(78120),
          roas: 11.8,
        },
      ],
      ageBreakdown: [],
    };
  if (path === "/api/analytics/performance")
    return {
      generatedAt: now,
      sources: {
        erp: { status: "connected", label: "ERP · Demonstração" },
        ecommerce: {
          status: "connected",
          label: "Ecommerce · Demonstração",
          message: null,
        },
        media: {
          status: "connected",
          label: "Meta · Demonstração",
          message: null,
        },
      },
      kpis: {
        grossRevenue: money(320000),
        netRevenue: d.revenue,
        returnAmount: 0,
        attributedRevenue: money(221400),
        unattributedRevenue: money(83638),
        mediaSpend: spend,
        roas: 7.8,
        mer: 10.74,
        cogs: money(171000),
        grossProfit: money(134038),
        roi: 3.72,
        roiStatus: "available",
        costCoveragePct: 100,
        orders: d.orders,
        attributedOrders: 620,
        attributionCoveragePct: 72.5,
        uniqueBuyers: 512,
        newBuyers: 326,
        returningBuyers: 186,
        retentionPct: 36.3,
        totalQuantity: 4820,
        returnedQuantity: 0,
        discountAmount: money(14962),
        cancelledOrders: 18,
        cancelledAmount: money(6320),
        averageTicket: d.avgTicket,
        avgItemsPerOrder: 5.6,
        returnRatePct: 0,
        discountRatePct: 4.7,
        grossMarginPct: 43.9,
        attributedBuyers: 380,
        newAttributedBuyers: 248,
        revenueAttributionCoveragePct: 72.58,
        impressions: 1240000,
        clicks: 25180,
        leads: 1840,
        metaPurchases: 620,
        ctr: 2.03,
        cpc: 1.13,
        cpl: 15.43,
        cac: 114.52,
      },
      reconciliation: [
        {
          label: "Pedidos conciliados",
          value: 620,
          detail: "Dados de demonstração.",
        },
      ],
      daily: days.map((p, index) => ({
        date: p.date,
        revenue: p.value,
        attributedRevenue: p.value * 0.72,
        spend: spend / days.length,
        orders: dashboard.ordersOverTime[index]?.value ?? 0,
      })),
      channels: [
        {
          channel: "Meta",
          spend,
          revenue: money(221400),
          orders: 620,
          roas: 7.8,
        },
      ],
      breakdowns: {
        colors: [{ name: "Preto", value: money(78000) }],
        sizes: [{ name: "M", value: money(49000) }],
        states: [{ name: "SP", value: money(128600) }],
      },
      funnel: [
        {
          key: "impressions",
          label: "Impressões",
          value: 1240000,
          previousRate: null,
          overallRate: 100,
          source: "Meta Ads",
        },
        {
          key: "clicks",
          label: "Cliques",
          value: 25180,
          previousRate: 2.03,
          overallRate: 2.03,
          source: "Meta Ads",
        },
      ],
      quality: [
        {
          key: "cost",
          label: "Cobertura de custo",
          value: 100,
          status: "good",
          detail: "Dados de demonstração.",
        },
      ],
      campaigns: creativeRows.map((row) => ({
        ...row,
        id: row.id,
        name: row.name,
        spend: row.spend,
        leads: row.leads,
        purchases: row.approvedLeads,
        revenue: row.attributedRevenue,
        orders: row.approvedLeads,
        roas: row.roas,
        cpl: row.cpl,
      })),
      orders: { rows: erpOrders, total: erpOrders.length, page: 1, limit: 10 },
    };
  if (path === "/api/analytics/erp/dashboard")
    return {
      kpis: {
        grossRevenue: money(320000),
        netRevenue: d.revenue,
        discountAmount: money(14962),
        orders: d.orders,
        totalQuantity: 4820,
        returnedQuantity: 0,
        uniqueCustomers: 512,
        newCustomers: 326,
        returningCustomers: 186,
        retentionPct: 36.3,
        cancelledOrders: 18,
        cancelledAmount: money(6320),
        avgTicket: d.avgTicket,
        returnAmount: 0,
        avgItemsPerOrder: 5.6,
        returnRatePct: 0,
        discountRatePct: 4.7,
      },
      revenueOverTime: dashboard.revenueOverTime,
      ordersOverTime: dashboard.ordersOverTime,
      newCustomersOverTime: dashboard.newBuyersOverTime,
      returningCustomersOverTime: dashboard.returningBuyersOverTime,
      attribution: {
        attributedCustomers: 380,
        unattributedCustomers: 132,
        attributedRevenue: money(221400),
        unattributedRevenue: money(83638),
      },
      breakdowns: {
        statuses: [{ label: "Faturado", orders: 855, revenue: d.revenue }],
        payments: [{ label: "PIX", orders: 510, revenue: money(180000) }],
        sellers: sellers.map((s) => ({
          label: s.name,
          orders: s.totalOrders,
          revenue: s.totalRevenue,
        })),
        stores: [{ label: "Loja UP", orders: 855, revenue: d.revenue }],
        states: breakdown,
      },
    };
  if (path === "/api/analytics/erp/orders")
    return { rows: erpOrders, total: erpOrders.length };
  if (path === "/api/analytics/erp/customers")
    return {
      rows: erpCustomers,
      total: erpCustomers.length,
      page: 1,
      limit: 10,
    };
  if (path === "/api/analytics/erp/products")
    return {
      rows: erpProducts,
      total: erpProducts.length,
      page: 1,
      limit: 10,
      kpis: {
        stockUnits: 480,
        totalRevenue: d.revenue,
        salesPower: 860.45,
        totalUnits: 4820,
        activeProducts: 5,
        coverageDays: 24,
        turnoverPct: 68,
      },
      breakdowns: { categories: [], colors: [], sizes: [] },
    };
  if (path === "/api/analytics/erp/attribution")
    return {
      allOrders: erpOrders.map((row, index) => ({
        orderId: row.id,
        channel: "erp",
        customerName: row.customerName,
        document: null,
        upzeroCustomerId: row.customerId,
        valor: row.netAmount,
        valorPago: row.netAmount,
        dataCriado: row.createdAt,
        attributed: true,
        attributionState: "PAID_ORIGIN",
        cohort: index < 2 ? "novo" : "recorrente",
        touchpointAt: row.createdAt,
        touchpointSource: "Meta",
      })),
      influencedTotal: 4,
      influencedCustomers: 4,
      cohortSummary: ["novo", "recorrente", "reativado"].map(
        (cohort, index) => ({
          cohort,
          clientes: 24 - index * 7,
          pedidos: 48 - index * 12,
          pedidosPagos: 48 - index * 12,
          faturamentoGerado: money(25000 - index * 6200),
          faturamentoPago: money(25000 - index * 6200),
          ticketMedio: 520.8,
        }),
      ),
      customerCohorts: [],
      fetchErrors: [],
    };
  if (path === "/api/analytics/recompra/dashboard")
    return {
      period,
      comparisonPeriod: null,
      blocks,
      blocksP2: url.searchParams.get("compareDateFrom") ? blocks : null,
    };
  if (path === "/api/analytics/recompra/detail")
    return {
      period,
      rows: customers.map((c, index) => ({
        customerId: c.id,
        cliente: c.name,
        dataEvento: now,
        diasDesde: 28 + index * 8,
        tipo: "recorrente",
        vendedora: sellers[index % 3].name,
        origem: "Meta",
        faturamentoNoPeriodo: money(2480 + index * 340),
        vendasNoPeriodo: 4,
        codigoPedido: `UP-1024${index}`,
        ultimaCompraAnterior: "2026-08-12",
      })),
      total: 4,
      page: 1,
      limit: 100,
      attributionUnavailable: false,
    };
  if (path === "/api/analytics/recompra/sellers")
    return {
      period,
      rows: sellers.map((s) => ({
        vendedora: s.name,
        clientesRecompra: 62,
        clientesRecorrentes: 48,
        clientesReativados: 14,
        vendas: 108,
        faturamento: money(39413),
        ticketMedio: 364.94,
      })),
      total: 3,
      attributionUnavailable: false,
    };
  if (path === "/api/analytics/recompra/monthly-trend")
    return {
      months: Array.from({ length: 12 }, (_, index) => ({
        month: `2026-${String(index + 1).padStart(2, "0")}`,
        faturamento: 82000 + index * 2400,
        vendas: 220 + index * 8,
        clientes: 128 + index * 5,
        recorrentes: {
          clientes: 96 + index * 4,
          vendas: 180 + index * 5,
          faturamento: 68000 + index * 1800,
        },
        reativados: {
          clientes: 32 + index,
          vendas: 40 + index * 3,
          faturamento: 14000 + index * 600,
        },
      })),
      attributionUnavailable: false,
    };
  if (path === "/api/analytics/recompra/history-insights")
    return {
      funnel: Array.from({ length: 6 }, (_, index) => ({
        compra: `${index + 1}ª Compra`,
        clientes: 820 - index * 110,
        retencao: 100 - index * 13,
      })),
      cohort: Array.from({ length: 6 }, (_, index) => ({
        mes: `2026-${String(index + 1).padStart(2, "0")}`,
        clientes: 82 + index * 9,
        d30: 24 + index,
        d60: 32 + index,
        d90: 38 + index,
        d180: 48 + index,
        hoje: 56 + index,
      })),
    };
  if (path === "/api/analytics/site-visits")
    return {
      rows: days.map((p, index) => ({
        id: `visit-${index}`,
        clientId: "design-b2b",
        visitDate: p.date,
        visitCount: 760 + index * 12,
      })),
      totalVisits: 24520,
      dailyPurchases: dashboard.ordersOverTime.map((p) => ({
        date: p.date,
        count: p.value,
      })),
    };
  if (path === "/api/analytics/funnel")
    return {
      steps: [
        {
          step: "VISIT",
          label: "Visitas",
          count: 24520,
          conversionRate: 100,
          dropOffRate: 0,
        },
        {
          step: "REGISTRATION",
          label: "Cadastros",
          count: 2380,
          conversionRate: 9.7,
          dropOffRate: 90.3,
        },
        {
          step: "APPROVED_REGISTRATION",
          label: "Cadastros Aprovados",
          count: 1732,
          conversionRate: 72.8,
          dropOffRate: 27.2,
        },
        {
          step: "ADD_TO_CART",
          label: "Adições ao Carrinho",
          count: 1240,
          conversionRate: 71.6,
          dropOffRate: 28.4,
        },
        {
          step: "CHECKOUT",
          label: "Checkout",
          count: 980,
          conversionRate: 79,
          dropOffRate: 21,
        },
        {
          step: "PURCHASE",
          label: "Compras",
          count: 842,
          conversionRate: 85.9,
          dropOffRate: 14.1,
        },
      ],
      overallConversion: 48.6,
      avgEventsBeforePurchase: 4.8,
      topPaths: [],
      suggestedActions: [],
      insights: ["Dados ilustrativos da demonstração."],
      hasSiteVisitData: true,
      activation: {
        approvedCustomers: 1732,
        windows: [
          {
            key: "same_day",
            label: "Mesmo dia",
            days: 0,
            activatedCustomers: 210,
            activationRate: 12.1,
          },
          {
            key: "within_30d",
            label: "Até 30 dias",
            days: 30,
            activatedCustomers: 842,
            activationRate: 48.6,
          },
        ],
        sameDayActivationRate: 12.1,
        thirtyDayActivationRate: 48.6,
        avgDaysToFirstPurchase: 8.6,
        firstPurchaseAov: 356.77,
        repeatAfterFirstPurchaseCustomers: 186,
        repeatAfterFirstPurchaseRate: 22.1,
        postApproval: {
          login: 1490,
          priceView: 1340,
          addToCart: 1240,
          orderSubmitted: 980,
          paymentConfirmed: 842,
          loginRate: 86,
          priceViewRate: 77.4,
          addToCartRate: 71.6,
          orderSubmittedRate: 56.6,
          paymentConfirmedRate: 48.6,
        },
        performance: {
          label: "Em evolução",
          tone: "good",
          benchmark: "Demonstração",
        },
        diagnostics: ["Dados de exemplo da prévia."],
        recommendation: "Exemplo de acompanhamento da ativação.",
        operationTypes: [],
      },
    };

  if (path.startsWith("/api/analytics/orders-page/")) {
    const index = Number(path.split("-").at(-1)) || 0;
    const customer = customers[index % customers.length];
    const amount = 2480 + index * 340;
    return {
      order: {
        id: `order-${index}`,
        externalId: `UP-1024${index}`,
        amount,
        fulfilledAmount: amount,
        requestedQuantity: 18 + index,
        fulfilledQuantity: 18 + index,
        status: "APPROVED",
        createdAt: now,
        approvalDate: now,
        shippingAmount: 0,
        discountAmount: 0,
        cancelledAmount: 0,
      },
      customer: { ...customer, document: null },
      items: products
        .slice(0, 2)
        .map((p, i) => ({
          id: `item-${i}`,
          quantity: 4,
          fulfilledQuantity: 4,
          priceAtSale: p.price,
          grossPriceAtSale: p.price,
          discountAmount: 0,
          size: "M",
          color: "Preto",
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          imageUrl: null,
        })),
    };
  }
  if (path === "/api/analytics/journey")
    return {
      kpis: {
        avgEventsBeforePurchase: 4.8,
        avgTimeToFirstPurchaseDays: 8.6,
        avgTimeBetweenPurchasesDays: 42.6,
        pctBuyersFromFirstSession: 28.4,
      },
      topPaths: [
        {
          steps: ["Visita", "Produto", "Carrinho", "Compra"],
          visitCount: 284,
          conversionRate: 36.7,
        },
      ],
      eventNodes: [
        { id: "VISIT", label: "Visita", count: 24520, layer: 0 },
        { id: "PRODUCT_VIEW", label: "Produto", count: 8400, layer: 1 },
        { id: "ADD_TO_CART", label: "Carrinho", count: 1240, layer: 2 },
        { id: "PURCHASE", label: "Compra", count: 842, layer: 3 },
      ],
      eventEdges: [
        { source: "VISIT", target: "PRODUCT_VIEW", count: 8400 },
        { source: "PRODUCT_VIEW", target: "ADD_TO_CART", count: 1240 },
        { source: "ADD_TO_CART", target: "PURCHASE", count: 842 },
      ],
      buyers: {
        avgSessionDepth: 5.2,
        eventCounts: [
          { eventType: "VISIT", count: 842 },
          { eventType: "ADD_TO_CART", count: 630 },
        ],
        topUtmSources: [{ source: "Instagram", count: 540 }],
      },
      nonBuyers: {
        avgSessionDepth: 2.6,
        eventCounts: [
          { eventType: "VISIT", count: 1240 },
          { eventType: "ADD_TO_CART", count: 248 },
        ],
        topUtmSources: [{ source: "Google", count: 620 }],
      },
    };
  if (path === "/api/analytics/rfm")
    return {
      segments: ["Champions", "Loyal", "Potential", "At Risk", "Lost"].map(
        (segment, index) => ({
          segment,
          customerCount: 120 - index * 14,
          revenue: money(48000 - index * 6000),
          avgTicket: 356.77,
          pct: 20,
        }),
      ),
      composition: Array.from({ length: 6 }, (_, index) => ({
        month: `2026-${String(index + 1).padStart(2, "0")}`,
        Champions: 120 + index * 5,
        Loyal: 106 + index * 4,
        Potential: 92,
        AtRisk: 78,
        Lost: 64,
      })),
      customers: [],
      total: 0,
      page: 1,
      limit: 50,
    };
  if (path === "/api/analytics/utm")
    return {
      kpis: {
        totalSessions: 24520,
        totalRegistrations: 2380,
        totalApprovals: 1732,
        approvalPct: 72.8,
        totalBuyers: 842,
        totalRevenue: d.revenue,
        conversionPct: 35.4,
        totalRoas: 12.89,
        topSource: "Instagram",
        topSourceRevenue: money(221400),
      },
      rows: [
        {
          key: "Instagram",
          source: "instagram",
          medium: "paid_social",
          campaign: "Primavera",
          registrations: 1840,
          approvals: 1332,
          approvalPct: 72.4,
          buyers: 620,
          revenue: money(221400),
          conversionPct: 33.7,
          roas: 12.89,
          subRows: [],
        },
      ],
    };
  if (path === "/api/analytics/stock") {
    const skus = products.map((p, index) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      stock: p.stock,
      restockThreshold: 10,
      dailyVelocity: 3.4,
      coverageDays: index === 0 ? 1.2 : 28,
      risk: index === 0 ? "Stockout" : "Healthy",
      unitsSold: p.totalSold,
      lastRestockDate: now,
      bySize: [
        { size: "M", unitsSold: 80 },
        { size: "G", unitsSold: 62 },
      ],
      byColor: [{ color: "Preto", unitsSold: 140 }],
      gradeStatus: p.gradeStatus,
      variantCount: 4,
      availableVariantCount: index === 0 ? 2 : 4,
      variants: p.variants,
    }));
    const kpis = {
      totalUnits: 480,
      avgCoverageDays: 24,
      stockoutRiskCount: 1,
      overstockRiskCount: 0,
      sellThroughRate: 68,
    };
    return {
      kpis,
      prevKpis: { ...kpis, totalUnits: 440, sellThroughRate: 62 },
      stockoutRisk: skus.slice(0, 1),
      overstockRisk: [],
      highTurnover: skus.slice(1, 4),
      categoryBreakdown: products.map((p) => ({
        category: p.category,
        stockUnits: p.stock,
        unitsSold: p.totalSold,
        dailyVelocity: 3.4,
      })),
      colorBreakdown: [{ color: "Preto", unitsSold: 780, stockUnits: 480 }],
      sizeBreakdown: [
        { size: "M", unitsSold: 420, stockUnits: 220 },
        { size: "G", unitsSold: 360, stockUnits: 260 },
      ],
      skus,
      total: 5,
      page: 1,
      limit: 50,
    };
  }
  return undefined;
}
