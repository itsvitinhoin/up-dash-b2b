import { and, eq, inArray, sql } from "drizzle-orm";
import { db, clientsTable, customersTable, ordersTable } from "@workspace/db";

const UPZERO_BASE = "https://api.upzero.com.br";
const PAGE_LIMIT = 200;
const SYNC_DAYS = 90;

type UpZeroStatus =
  | "RESERVED"
  | "CONFIRMED"
  | "PROCESSING"
  | "INVOICED"
  | "SHIPPED"
  | "CANCELED";

function mapOrderStatus(
  s: UpZeroStatus,
): "PENDING" | "APPROVED" | "SHIPPED" | "REJECTED" {
  switch (s) {
    case "RESERVED":
      return "PENDING";
    case "CONFIRMED":
    case "PROCESSING":
    case "INVOICED":
      return "APPROVED";
    case "SHIPPED":
      return "SHIPPED";
    case "CANCELED":
      return "REJECTED";
    default:
      return "PENDING";
  }
}

interface UpZeroAddress {
  address_state?: string | null;
  address_city?: string | null;
}

interface UpZeroCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  wholesale_profile?: UpZeroAddress | null;
  retail_profile?: UpZeroAddress | null;
}

interface UpZeroOrder {
  id: string;
  order_status: UpZeroStatus;
  total: string;
  subtotal?: string;
  created_at: string;
  customer?: UpZeroCustomer | null;
  shipping_address?: UpZeroAddress | null;
}

interface PagedResponse<T> {
  data: T[];
  page: number;
  total_pages: number;
  total: number;
}

async function fetchAllPages<T>(
  apiKey: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      page: String(page),
      ...extraParams,
    });
    const url = `${UPZERO_BASE}${path}?${params}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(
        `UP Zero API error: ${res.status} ${res.statusText} — ${path}`,
      );
    }
    const body = (await res.json()) as PagedResponse<T>;
    results.push(...(body.data ?? []));
    if (page >= (body.total_pages ?? 1)) break;
    page++;
  }

  return results;
}

function getAddressState(c: UpZeroCustomer): string | null {
  return (
    c.address_state ??
    c.wholesale_profile?.address_state ??
    c.retail_profile?.address_state ??
    null
  );
}

function getAddressCity(c: UpZeroCustomer): string | null {
  return (
    c.address_city ??
    c.wholesale_profile?.address_city ??
    c.retail_profile?.address_city ??
    null
  );
}

export interface SyncResult {
  customersCreated: number;
  customersUpdated: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
}

export async function syncUpZeroClient(
  clientId: string,
  apiKey: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    customersCreated: 0,
    customersUpdated: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    errors: [],
  };

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - SYNC_DAYS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let upCustomers: UpZeroCustomer[] = [];
  let upOrders: UpZeroOrder[] = [];

  try {
    [upCustomers, upOrders] = await Promise.all([
      fetchAllPages<UpZeroCustomer>(apiKey, "/external/v1/customers"),
      fetchAllPages<UpZeroOrder>(apiKey, "/external/v1/orders", {
        start_date: fmt(startDate),
        end_date: fmt(endDate),
      }),
    ]);
  } catch (err) {
    result.errors.push(String(err));
    return result;
  }

  const externalToInternalCustomer = new Map<string, string>();

  if (upCustomers.length > 0) {
    const externalIds = upCustomers.map((c) => c.id);

    const existing = await db
      .select({ id: customersTable.id, externalId: customersTable.externalId })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId),
          inArray(customersTable.externalId, externalIds),
        ),
      );

    const existingByExtId = new Map<string, string>();
    for (const row of existing) {
      if (row.externalId) existingByExtId.set(row.externalId, row.id);
    }

    const emails = upCustomers
      .filter((c) => c.email && !existingByExtId.has(c.id))
      .map((c) => c.email as string);

    const existingByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const emailRows = await db
        .select({ id: customersTable.id, email: customersTable.email })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            inArray(customersTable.email, emails),
          ),
        );
      for (const row of emailRows) {
        existingByEmail.set(row.email, row.id);
      }
    }

    for (const c of upCustomers) {
      try {
        const state = getAddressState(c);
        const city = getAddressCity(c);
        const email = c.email ?? `upzero-${c.id}@noemail.internal`;

        if (existingByExtId.has(c.id)) {
          const internalId = existingByExtId.get(c.id)!;
          externalToInternalCustomer.set(c.id, internalId);
          await db
            .update(customersTable)
            .set({
              name: c.name ?? undefined,
              phone: c.phone ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, internalId),
              ),
            );
          result.customersUpdated++;
        } else if (c.email && existingByEmail.has(c.email)) {
          const internalId = existingByEmail.get(c.email)!;
          externalToInternalCustomer.set(c.id, internalId);
          await db
            .update(customersTable)
            .set({
              externalId: c.id,
              name: c.name ?? undefined,
              phone: c.phone ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, internalId),
              ),
            );
          result.customersUpdated++;
        } else {
          const [upserted] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: c.id,
              email,
              name: c.name ?? null,
              phone: c.phone ?? null,
              state,
              city,
              registrationStatus: "APPROVED",
              approvalDate: new Date(),
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: {
                name: c.name ?? null,
                phone: c.phone ?? null,
                state,
                city,
              },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
            });
          if (upserted) {
            externalToInternalCustomer.set(c.id, upserted.id);
            if (upserted.wasInserted) {
              result.customersCreated++;
            } else {
              result.customersUpdated++;
            }
          }
        }
      } catch (err) {
        result.errors.push(`Customer ${c.id}: ${String(err)}`);
      }
    }
  }

  const externalOrderIds = upOrders.map((o) => o.id);

  const existingOrders =
    externalOrderIds.length > 0
      ? await db
          .select({
            id: ordersTable.id,
            externalId: ordersTable.externalId,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              inArray(ordersTable.externalId, externalOrderIds),
            ),
          )
      : [];

  const existingOrderByExtId = new Map<string, string>();
  for (const row of existingOrders) {
    if (row.externalId) existingOrderByExtId.set(row.externalId, row.id);
  }

  for (const o of upOrders) {
    try {
      const amount = parseFloat(o.total) || 0;
      const status = mapOrderStatus(o.order_status);
      const createdAt = new Date(o.created_at);
      const approvalDate =
        status === "APPROVED" || status === "SHIPPED" ? createdAt : undefined;

      const uzCustomer = o.customer;
      let customerId: string | null = null;

      if (uzCustomer) {
        customerId = externalToInternalCustomer.get(uzCustomer.id) ?? null;

        if (!customerId) {
          const email =
            uzCustomer.email ??
            `upzero-${uzCustomer.id}@noemail.internal`;
          const state = getAddressState(uzCustomer);
          const city = getAddressCity(uzCustomer);
          const [upsertedCust] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: uzCustomer.id,
              email,
              name: uzCustomer.name ?? null,
              phone: uzCustomer.phone ?? null,
              state,
              city,
              registrationStatus: "APPROVED",
              approvalDate: new Date(),
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: { name: uzCustomer.name ?? null },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
            });
          if (upsertedCust) {
            customerId = upsertedCust.id;
            externalToInternalCustomer.set(uzCustomer.id, upsertedCust.id);
            if (upsertedCust.wasInserted) {
              result.customersCreated++;
            } else {
              result.customersUpdated++;
            }
          }
        }
      }

      if (!customerId) {
        result.errors.push(`Order ${o.id}: no customer found, skipping`);
        continue;
      }

      const shippingAddr = o.shipping_address ?? o.customer;
      const state =
        (shippingAddr as UpZeroAddress | null)?.address_state ?? null;
      const city =
        (shippingAddr as UpZeroAddress | null)?.address_city ?? null;

      if (existingOrderByExtId.has(o.id)) {
        const internalId = existingOrderByExtId.get(o.id)!;
        await db
          .update(ordersTable)
          .set({ amount, status, state, city })
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              eq(ordersTable.id, internalId),
            ),
          );
        result.ordersUpdated++;
      } else {
        const [upsertedOrder] = await db
          .insert(ordersTable)
          .values({
            clientId,
            customerId,
            externalId: o.id,
            amount,
            status,
            approvalDate,
            state,
            city,
            createdAt,
          })
          .onConflictDoUpdate({
            target: [ordersTable.clientId, ordersTable.externalId],
            set: { amount, status, state, city },
          })
          .returning({ id: ordersTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
        if (upsertedOrder?.wasInserted) {
          result.ordersCreated++;
        } else {
          result.ordersUpdated++;
        }
      }
    } catch (err) {
      result.errors.push(`Order ${o.id}: ${String(err)}`);
    }
  }

  if (result.customersCreated + result.ordersCreated > 0) {
    await db
      .update(clientsTable)
      .set({ revenueYtd: 0, ordersYtd: 0 })
      .where(eq(clientsTable.id, clientId));

    const aggResult = await db.execute<{ revenue: number; orders: number }>(
      sql`
        SELECT
          COALESCE(SUM(amount), 0)::float AS revenue,
          COUNT(*)::int AS orders
        FROM orders
        WHERE client_id = ${clientId}
          AND status IN ('APPROVED','SHIPPED','DELIVERED')
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
      `,
    );
    const agg = aggResult.rows[0];
    if (agg) {
      await db
        .update(clientsTable)
        .set({
          revenueYtd: Number(agg.revenue) || 0,
          ordersYtd: Number(agg.orders) || 0,
        })
        .where(eq(clientsTable.id, clientId));
    }
  }

  return result;
}
