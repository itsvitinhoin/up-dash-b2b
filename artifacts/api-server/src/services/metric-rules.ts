import { sql, type SQL } from "drizzle-orm";
import { ordersTable } from "@workspace/db";

/** Faturamento pago: creation-date cohort, current paid/fulfilled status. */
export function paidOrderStatus(): SQL {
  return sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`;
}

export function paidRevenueColumn(isB2C: boolean | SQL): SQL {
  if (typeof isB2C === "boolean")
    return sql`${isB2C ? ordersTable.fulfilledAmount : ordersTable.amount}`;
  return sql`CASE WHEN ${isB2C} THEN ${ordersTable.fulfilledAmount} ELSE ${ordersTable.amount} END`;
}
