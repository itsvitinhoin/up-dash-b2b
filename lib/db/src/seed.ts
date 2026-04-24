import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, and, sql } from "drizzle-orm";
import { db, pool } from "./index";
import {
  usersTable,
  clientsTable,
  customersTable,
  productsTable,
  sellersTable,
  ordersTable,
  orderItemsTable,
  eventsTable,
  creativesTable,
} from "./schema";

const BR_STATES = [
  "SP",
  "RJ",
  "MG",
  "RS",
  "BA",
  "PR",
  "SC",
  "GO",
  "PE",
  "CE",
];
const STATE_CITIES: Record<string, string[]> = {
  SP: ["São Paulo", "Campinas", "Santos", "Ribeirão Preto"],
  RJ: ["Rio de Janeiro", "Niterói", "Petrópolis"],
  MG: ["Belo Horizonte", "Uberlândia", "Juiz de Fora"],
  RS: ["Porto Alegre", "Caxias do Sul"],
  BA: ["Salvador", "Feira de Santana"],
  PR: ["Curitiba", "Londrina"],
  SC: ["Florianópolis", "Joinville"],
  GO: ["Goiânia", "Anápolis"],
  PE: ["Recife", "Olinda"],
  CE: ["Fortaleza", "Sobral"],
};
const CATEGORIES = [
  "Dresses",
  "Tops",
  "Bottoms",
  "Outerwear",
  "Accessories",
  "Shoes",
];
const PRODUCT_NAMES = [
  "Linen Maxi Dress",
  "Cropped Denim Jacket",
  "High-Waist Trousers",
  "Silk Blouse",
  "Wool Overcoat",
  "Leather Belt",
  "Chunky Knit Sweater",
  "Pleated Midi Skirt",
  "Tailored Blazer",
  "Vintage Tee",
  "Wide-Leg Pants",
  "Cashmere Cardigan",
  "Slip Dress",
  "Bomber Jacket",
  "Suede Loafers",
  "Pointed-Toe Heels",
  "Canvas Sneakers",
  "Leather Tote",
  "Statement Earrings",
  "Silk Scarf",
  "Crossbody Bag",
  "Aviator Sunglasses",
  "Trench Coat",
  "Pencil Skirt",
];
const COLORS = ["Black", "Cream", "Camel", "Olive", "Burgundy", "Navy"];
const SIZES = ["XS", "S", "M", "L", "XL"];
const RFM_SEGMENTS = ["Champions", "Loyal", "Promising", "At Risk", "Lost"];
const ORDER_STATUSES = [
  "PENDING",
  "APPROVED",
  "APPROVED",
  "APPROVED",
  "SHIPPED",
  "SHIPPED",
  "DELIVERED",
  "DELIVERED",
  "DELIVERED",
  "REJECTED",
] as const;
const UTM_SOURCES = ["instagram", "google", "facebook", "tiktok", "direct"];
const UTM_CAMPAIGNS = [
  "summer_collection",
  "black_friday",
  "vip_launch",
  "remarketing",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomDateBetween(start: Date, end: Date): Date {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime()),
  );
}

function rfmFromMetrics(
  totalOrders: number,
  totalSpent: number,
  lastPurchase: Date | null,
): {
  segment: string;
  recency: number;
  frequency: number;
  monetary: number;
} {
  const daysSince = lastPurchase
    ? Math.floor((Date.now() - lastPurchase.getTime()) / 86400000)
    : 9999;
  const recency =
    daysSince <= 30
      ? 5
      : daysSince <= 60
        ? 4
        : daysSince <= 90
          ? 3
          : daysSince <= 180
            ? 2
            : 1;
  const frequency =
    totalOrders >= 10
      ? 5
      : totalOrders >= 5
        ? 4
        : totalOrders >= 3
          ? 3
          : totalOrders >= 2
            ? 2
            : 1;
  const monetary =
    totalSpent >= 5000
      ? 5
      : totalSpent >= 2500
        ? 4
        : totalSpent >= 1000
          ? 3
          : totalSpent >= 500
            ? 2
            : 1;
  let segment = "Lost";
  if (recency >= 4 && frequency >= 4 && monetary >= 4) segment = "Champions";
  else if (recency >= 3 && frequency >= 3) segment = "Loyal";
  else if (frequency >= 3 || monetary >= 3) segment = "Promising";
  else if (recency <= 2) segment = "At Risk";
  return { segment, recency, frequency, monetary };
}

async function reset() {
  await db.delete(eventsTable);
  await db.delete(orderItemsTable);
  await db.delete(ordersTable);
  await db.delete(creativesTable);
  await db.delete(productsTable);
  await db.delete(customersTable);
  await db.delete(sellersTable);
  await db.delete(clientsTable);
  await db.delete(usersTable);
}

async function main() {
  console.log("Resetting database...");
  await reset();

  console.log("Creating users...");
  const adminPasswordHash = await bcrypt.hash("Admin123!", 10);
  const clientPasswordHash = await bcrypt.hash("Client123!", 10);

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: "admin@updash.com",
      passwordHash: adminPasswordHash,
      firstName: "Ada",
      lastName: "Lovelace",
      role: "ADMIN",
    })
    .returning();

  const clientUsers = await db
    .insert(usersTable)
    .values([
      {
        email: "owner@aurora.com",
        passwordHash: clientPasswordHash,
        firstName: "Mariana",
        lastName: "Costa",
        role: "CLIENT",
      },
      {
        email: "owner@noir.com",
        passwordHash: clientPasswordHash,
        firstName: "Beatriz",
        lastName: "Almeida",
        role: "CLIENT",
      },
    ])
    .returning();

  console.log("Creating clients...");
  const clientSeeds = [
    {
      name: "Aurora Atelier",
      email: "contact@aurora.com",
      apiKey: `sk_${nanoid(24)}`,
      adminId: admin.id,
      userId: clientUsers[0].id,
    },
    {
      name: "Noir Studio",
      email: "contact@noir.com",
      apiKey: `sk_${nanoid(24)}`,
      adminId: admin.id,
      userId: clientUsers[1].id,
    },
  ];
  const clients = await db
    .insert(clientsTable)
    .values(clientSeeds)
    .returning();

  for (const client of clients) {
    console.log(`\nSeeding data for ${client.name}...`);

    // Sellers
    const sellerNames = [
      "Carla Mendes",
      "Diego Ramos",
      "Helena Souza",
      "Lucas Oliveira",
      "Patricia Lima",
    ];
    const sellers = await db
      .insert(sellersTable)
      .values(
        sellerNames.map((name) => ({
          clientId: client.id,
          name,
          email: `${name.toLowerCase().replace(/\s/g, ".")}@${client.name.toLowerCase().replace(/\s/g, "")}.com`,
        })),
      )
      .returning();

    // Products
    const productCount = 24;
    const productSeeds: Array<typeof productsTable.$inferInsert> = [];
    for (let i = 0; i < productCount; i++) {
      const name = PRODUCT_NAMES[i % PRODUCT_NAMES.length];
      const restockThreshold = randInt(8, 25);
      // Bias roughly a quarter of products to be at-or-below threshold so the
      // alerts panel has signal in seeded demos.
      const stock = i % 4 === 0 ? randInt(0, restockThreshold) : randInt(restockThreshold + 1, 200);
      productSeeds.push({
        clientId: client.id,
        sku: `${client.name.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
        name,
        description: `${name} crafted from premium materials.`,
        category: pick(CATEGORIES),
        price: randInt(89, 899),
        cost: randInt(40, 350),
        stock,
        restockThreshold,
      });
    }
    const products = await db.insert(productsTable).values(productSeeds).returning();

    // Customers
    const customerCount = 220;
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 86400000);

    const customerSeeds: Array<typeof customersTable.$inferInsert> = [];
    for (let i = 0; i < customerCount; i++) {
      const state = pick(BR_STATES);
      const city = pick(STATE_CITIES[state] ?? ["Capital"]);
      const status = Math.random() < 0.85 ? "APPROVED" : Math.random() < 0.5 ? "PENDING" : "REJECTED";
      const createdAt = randomDateBetween(oneYearAgo, now);
      customerSeeds.push({
        clientId: client.id,
        email: `customer${i + 1}_${nanoid(6)}@example.com`,
        name: `Customer ${i + 1}`,
        phone: `+5511${randInt(900000000, 999999999)}`,
        state,
        city,
        utmSource: pick(UTM_SOURCES),
        utmMedium: "cpc",
        utmCampaign: pick(UTM_CAMPAIGNS),
        registrationStatus: status,
        approvalDate: status === "APPROVED" ? randomDateBetween(createdAt, now) : null,
        createdAt,
      });
    }
    const customers = await db
      .insert(customersTable)
      .values(customerSeeds)
      .returning();

    // Orders + items + events
    const orderCount = 600;
    const customerStats = new Map<
      string,
      { orders: number; spent: number; first: Date | null; last: Date | null }
    >();
    const eventBatch: Array<typeof eventsTable.$inferInsert> = [];

    // Initial site visits & registrations & approvals events
    for (const customer of customers) {
      const visits = randInt(2, 8);
      for (let v = 0; v < visits; v++) {
        eventBatch.push({
          clientId: client.id,
          customerId: customer.id,
          eventType: "VISIT",
          createdAt: randomDateBetween(oneYearAgo, now),
        });
      }
      eventBatch.push({
        clientId: client.id,
        customerId: customer.id,
        eventType: "REGISTRATION",
        createdAt: customer.createdAt,
      });
      if (customer.registrationStatus === "APPROVED" && customer.approvalDate) {
        eventBatch.push({
          clientId: client.id,
          customerId: customer.id,
          eventType: "APPROVED_REGISTRATION",
          createdAt: customer.approvalDate,
        });
      }
    }

    const orderInserts: Array<typeof ordersTable.$inferInsert> = [];
    const itemInserts: Array<{
      orderIndex: number;
      productId: string;
      quantity: number;
      priceAtSale: number;
      size: string;
      color: string;
    }> = [];
    const purchaseEventQueue: Array<{
      orderIndex: number;
      customerId: string;
      createdAt: Date;
    }> = [];

    const approvedCustomers = customers.filter(
      (c) => c.registrationStatus === "APPROVED",
    );

    for (let i = 0; i < orderCount; i++) {
      const customer = pick(approvedCustomers.length > 0 ? approvedCustomers : customers);
      const status = pick(ORDER_STATUSES);
      const createdAt = randomDateBetween(
        new Date(Math.max(oneYearAgo.getTime(), customer.createdAt.getTime())),
        now,
      );
      const itemsForOrder = randInt(1, 4);
      let amount = 0;
      const orderIdx = i;
      for (let it = 0; it < itemsForOrder; it++) {
        const product = pick(products);
        const qty = randInt(1, 3);
        const price = product.price;
        amount += qty * price;
        itemInserts.push({
          orderIndex: orderIdx,
          productId: product.id,
          quantity: qty,
          priceAtSale: price,
          size: pick(SIZES),
          color: pick(COLORS),
        });
      }

      orderInserts.push({
        clientId: client.id,
        customerId: customer.id,
        sellerId: pick(sellers).id,
        amount,
        status,
        approvalDate: status === "APPROVED" || status === "SHIPPED" || status === "DELIVERED" ? createdAt : null,
        state: customer.state,
        city: customer.city,
        createdAt,
      });

      // add cart event
      if (Math.random() < 0.7) {
        eventBatch.push({
          clientId: client.id,
          customerId: customer.id,
          eventType: "ADD_TO_CART",
          createdAt: new Date(createdAt.getTime() - randInt(60, 3600) * 1000),
        });
      }
      if (Math.random() < 0.5) {
        eventBatch.push({
          clientId: client.id,
          customerId: customer.id,
          eventType: "CHECKOUT_STARTED",
          createdAt: new Date(createdAt.getTime() - randInt(30, 1800) * 1000),
        });
      }

      if (status !== "REJECTED" && status !== "PENDING") {
        purchaseEventQueue.push({
          orderIndex: orderIdx,
          customerId: customer.id,
          createdAt,
        });

        const stats = customerStats.get(customer.id) ?? {
          orders: 0,
          spent: 0,
          first: null,
          last: null,
        };
        stats.orders += 1;
        stats.spent += amount;
        if (!stats.first || createdAt < stats.first) stats.first = createdAt;
        if (!stats.last || createdAt > stats.last) stats.last = createdAt;
        customerStats.set(customer.id, stats);
      }
    }

    const insertedOrders = await db
      .insert(ordersTable)
      .values(orderInserts)
      .returning();

    // Map order index → real id
    await db.insert(orderItemsTable).values(
      itemInserts.map((it) => ({
        orderId: insertedOrders[it.orderIndex].id,
        productId: it.productId,
        quantity: it.quantity,
        priceAtSale: it.priceAtSale,
        size: it.size,
        color: it.color,
      })),
    );

    // Push purchase events with real order ids
    for (const p of purchaseEventQueue) {
      eventBatch.push({
        clientId: client.id,
        customerId: p.customerId,
        eventType: "PURCHASE",
        orderId: insertedOrders[p.orderIndex].id,
        createdAt: p.createdAt,
      });
    }

    // Insert events in chunks
    const chunk = 500;
    for (let i = 0; i < eventBatch.length; i += chunk) {
      await db.insert(eventsTable).values(eventBatch.slice(i, i + chunk));
    }

    // Update customer denormalized metrics + RFM
    for (const [customerId, stats] of customerStats) {
      const { segment, recency, frequency, monetary } = rfmFromMetrics(
        stats.orders,
        stats.spent,
        stats.last,
      );
      await db
        .update(customersTable)
        .set({
          totalOrders: stats.orders,
          totalSpent: stats.spent,
          firstPurchaseAt: stats.first,
          lastPurchaseAt: stats.last,
          rfmSegment: segment,
          recencyScore: recency,
          frequencyScore: frequency,
          monetaryScore: monetary,
        })
        .where(eq(customersTable.id, customerId));
    }

    // Mark customers without orders as Lost segment
    await db
      .update(customersTable)
      .set({ rfmSegment: "Lost", recencyScore: 1, frequencyScore: 1, monetaryScore: 1 })
      .where(
        and(
          eq(customersTable.clientId, client.id),
          eq(customersTable.totalOrders, 0),
        ),
      );

    // Update product denormalized metrics
    const productAgg = await db
      .select({
        productId: orderItemsTable.productId,
        sold: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})::float`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(ordersTable.clientId, client.id),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        ),
      )
      .groupBy(orderItemsTable.productId);
    for (const row of productAgg) {
      await db
        .update(productsTable)
        .set({ totalSold: row.sold, totalRevenue: row.revenue })
        .where(eq(productsTable.id, row.productId));
    }

    // Update seller denormalized metrics
    const sellerAgg = await db
      .select({
        sellerId: ordersTable.sellerId,
        orders: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, client.id),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        ),
      )
      .groupBy(ordersTable.sellerId);
    for (const row of sellerAgg) {
      if (!row.sellerId) continue;
      await db
        .update(sellersTable)
        .set({ totalOrders: row.orders, totalRevenue: row.revenue })
        .where(eq(sellersTable.id, row.sellerId));
    }

    // Update client denormalized metrics
    const [clientAgg] = await db
      .select({
        revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
        orders: sql<number>`COUNT(*)::int`,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, client.id),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        ),
      );
    const [leadsAgg] = await db
      .select({
        leads: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'REGISTRATION')::int`,
        approved: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'APPROVED_REGISTRATION')::int`,
      })
      .from(eventsTable)
      .where(eq(eventsTable.clientId, client.id));

    await db
      .update(clientsTable)
      .set({
        revenueYtd: clientAgg.revenue,
        ordersYtd: clientAgg.orders,
        leadsYtd: leadsAgg.leads,
        approvedLeads: leadsAgg.approved,
      })
      .where(eq(clientsTable.id, client.id));

    // Creatives
    const creativeDefs = [
      { name: "Spring Lookbook — Carousel", platform: "META" as const, spendMin: 1200, spendMax: 4500, clicksMin: 2000, clicksMax: 8000, impressionsMin: 80000, impressionsMax: 250000, leadsMin: 180, leadsMax: 650 },
      { name: "VIP Launch — Reels", platform: "META" as const, spendMin: 900, spendMax: 3500, clicksMin: 1500, clicksMax: 6000, impressionsMin: 60000, impressionsMax: 200000, leadsMin: 120, leadsMax: 500 },
      { name: "Remarketing — Abandoned Cart", platform: "META" as const, spendMin: 600, spendMax: 2000, clicksMin: 800, clicksMax: 3500, impressionsMin: 30000, impressionsMax: 100000, leadsMin: 80, leadsMax: 300 },
      { name: "Search — Brand Keywords", platform: "GOOGLE" as const, spendMin: 1500, spendMax: 5000, clicksMin: 3000, clicksMax: 10000, impressionsMin: 50000, impressionsMax: 180000, leadsMin: 200, leadsMax: 700 },
      { name: "Shopping — Best Sellers", platform: "GOOGLE" as const, spendMin: 800, spendMax: 3000, clicksMin: 1200, clicksMax: 5000, impressionsMin: 40000, impressionsMax: 150000, leadsMin: 100, leadsMax: 400 },
      { name: "TikTok For You — UGC", platform: "TIKTOK" as const, spendMin: 700, spendMax: 2800, clicksMin: 2500, clicksMax: 9000, impressionsMin: 100000, impressionsMax: 400000, leadsMin: 150, leadsMax: 550 },
      { name: "TikTok Spark — Influencer", platform: "TIKTOK" as const, spendMin: 1000, spendMax: 3200, clicksMin: 1800, clicksMax: 7000, impressionsMin: 80000, impressionsMax: 300000, leadsMin: 120, leadsMax: 450 },
    ];
    const approvalRateForClient = 0.72 + Math.random() * 0.15;
    // Assign campaign date windows: some are long-running (always active), some are
    // recent campaigns, some are past campaigns that may not overlap a short window.
    const creativeWindows = [
      // Long-running evergreen (META)
      { daysAgo: 180, durationDays: 365 },
      // Recent META campaign
      { daysAgo: 45, durationDays: 90 },
      // Short burst past META campaign
      { daysAgo: 70, durationDays: 30 },
      // Google search (evergreen)
      { daysAgo: 120, durationDays: 240 },
      // Google shopping (seasonal, recent)
      { daysAgo: 30, durationDays: 60 },
      // TikTok UGC (recent, running)
      { daysAgo: 25, durationDays: 90 },
      // TikTok Spark (very recent)
      { daysAgo: 10, durationDays: 60 },
    ];
    const creativeNow = new Date();
    await db.insert(creativesTable).values(
      creativeDefs.map((def, i) => {
        const leads = randInt(def.leadsMin, def.leadsMax);
        const approvedLeads = Math.round(leads * (approvalRateForClient - 0.05 + Math.random() * 0.1));
        const w = creativeWindows[i % creativeWindows.length];
        const activeFrom = new Date(creativeNow.getTime() - w.daysAgo * 86400_000);
        const activeTo = new Date(activeFrom.getTime() + w.durationDays * 86400_000);
        return {
          clientId: client.id,
          name: def.name,
          platform: def.platform,
          status: Math.random() < 0.85 ? "ACTIVE" : "PAUSED",
          clicks: randInt(def.clicksMin, def.clicksMax),
          impressions: randInt(def.impressionsMin, def.impressionsMax),
          spend: randInt(def.spendMin, def.spendMax),
          leads,
          approvedLeads,
          activeFrom: activeFrom.toISOString().split("T")[0],
          activeTo: activeTo.toISOString().split("T")[0],
        };
      }),
    );

    console.log(
      `  ✓ ${customers.length} customers, ${insertedOrders.length} orders, ${eventBatch.length} events`,
    );
  }

  console.log("\nSeed complete.");
  console.log("\nLogin credentials:");
  console.log("  Admin: admin@updash.com / Admin123!");
  console.log("  Client (Aurora): owner@aurora.com / Client123!");
  console.log("  Client (Noir): owner@noir.com / Client123!");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
