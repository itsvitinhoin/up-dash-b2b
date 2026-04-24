import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  notificationsTable,
  ordersTable,
  productsTable,
  orderItemsTable,
  type InsertNotification,
} from "@workspace/db";
import {
  ListNotificationsQueryParams,
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  MarkNotificationReadBody,
} from "@workspace/api-zod";
import { authenticate, resolveClientId } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/notifications", authenticate);

function requireClient(
  req: import("express").Request,
  res: import("express").Response,
): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "clientId query parameter is required for admin users",
      status: 400,
    });
    return null;
  }
  return clientId;
}

// Synthesize current "signals" from analytics data for a client and persist
// them as notifications (idempotent via signal_key). Runs at most once per
// hour per client to avoid noisy regeneration.
const lastSynth = new Map<string, number>();
const SYNTH_INTERVAL_MS = 60 * 60 * 1000;

async function maybeSynthesizeSignals(clientId: string): Promise<void> {
  const last = lastSynth.get(clientId) ?? 0;
  if (Date.now() - last < SYNTH_INTERVAL_MS) return;
  lastSynth.set(clientId, Date.now());

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dailyRevenue = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, since),
        lte(ordersTable.createdAt, now),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    )
    .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

  const inserts: InsertNotification[] = [];

  // Anomaly: a day whose revenue is > 2x the 7-day rolling avg ending the day before.
  for (let i = 7; i < dailyRevenue.length; i++) {
    const window = dailyRevenue.slice(i - 7, i);
    const windowAvg =
      window.reduce((acc, d) => acc + Number(d.revenue), 0) / window.length;
    const today = dailyRevenue[i];
    const value = Number(today.revenue);
    if (windowAvg > 0 && value > windowAvg * 2) {
      inserts.push({
        clientId,
        type: "ANOMALY",
        severity: "SUCCESS",
        title: `Revenue spike on ${today.date}`,
        body: `Revenue hit ${value.toFixed(2)} — ${(value / windowAvg).toFixed(1)}× the prior 7-day average. Worth a closer look.`,
        signalKey: `anomaly-${today.date}`,
      });
    }
    if (windowAvg > 0 && value < windowAvg * 0.4 && value > 0) {
      inserts.push({
        clientId,
        type: "ANOMALY",
        severity: "WARNING",
        title: `Revenue dip on ${today.date}`,
        body: `Revenue fell to ${value.toFixed(2)} — ${((1 - value / windowAvg) * 100).toFixed(0)}% below the prior 7-day average.`,
        signalKey: `dip-${today.date}`,
      });
    }
  }

  // Top mover: highest-revenue product in the window.
  const top = await db
    .select({
      name: productsTable.name,
      revenue: sql<number>`COALESCE(SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}), 0)::float`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, since),
        lte(ordersTable.createdAt, now),
      ),
    )
    .groupBy(productsTable.id, productsTable.name)
    .orderBy(sql`SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}) DESC`)
    .limit(1);

  const weekKey = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
  if (top[0]) {
    inserts.push({
      clientId,
      type: "TOP_MOVER",
      severity: "INFO",
      title: `Top mover: ${top[0].name}`,
      body: `${top[0].name} drove ${Number(top[0].revenue).toFixed(2)} in revenue over the last 30 days — your best-selling SKU.`,
      signalKey: `top-mover-${weekKey}`,
    });
  }

  // Weekly summary: orders + revenue.
  const totalRev = dailyRevenue.reduce((acc, d) => acc + Number(d.revenue), 0);
  inserts.push({
    clientId,
    type: "SUMMARY",
    severity: "INFO",
    title: `30-day rollup`,
    body: `Total revenue ${totalRev.toFixed(2)} across the trailing 30 days. Tap to open the dashboard.`,
    signalKey: `summary-${weekKey}`,
  });

  if (inserts.length > 0) {
    await db.insert(notificationsTable).values(inserts).onConflictDoNothing();
  }
}

router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  await maybeSynthesizeSignals(clientId);

  const limit = parsed.data.limit ?? 20;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.clientId, clientId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  const [{ unread }] = await db
    .select({
      unread: sql<number>`COUNT(*) FILTER (WHERE ${notificationsTable.isRead} = false)::int`,
    })
    .from(notificationsTable)
    .where(eq(notificationsTable.clientId, clientId));

  res.json(ListNotificationsResponse.parse({ data: rows, unreadCount: Number(unread) || 0 }));
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const updated = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.clientId, clientId),
        eq(notificationsTable.isRead, false),
      ),
    )
    .returning({ id: notificationsTable.id });

  res.json(MarkAllNotificationsReadResponse.parse({ updated: updated.length }));
});

router.post("/notifications/read", async (req, res): Promise<void> => {
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const parsed = MarkNotificationReadBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const conditions: SQL[] = [
    eq(notificationsTable.clientId, clientId),
    eq(notificationsTable.id, parsed.data.notificationId),
  ];

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(...conditions))
    .returning();

  if (!updated) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Notification not found",
      status: 404,
    });
    return;
  }
  res.json(MarkNotificationReadResponse.parse(updated));
});

export default router;
