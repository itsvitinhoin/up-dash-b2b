import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";
import { sellersTable } from "./sellers";
import { productsTable } from "./products";

export const ordersTable = pgTable(
  "orders",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    sellerId: text("seller_id").references(() => sellersTable.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"),
    amount: doublePrecision("amount").notNull(),
    status: text("status", {
      enum: ["PENDING", "APPROVED", "REJECTED", "SHIPPED", "DELIVERED"],
    })
      .notNull()
      .default("PENDING"),
    approvalDate: timestamp("approval_date", { withTimezone: true }),
    state: text("state"),
    city: text("city"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("orders_client_idx").on(table.clientId),
    customerIdx: index("orders_customer_idx").on(table.customerId),
    sellerIdx: index("orders_seller_idx").on(table.sellerId),
    statusIdx: index("orders_status_idx").on(table.status),
    createdAtIdx: index("orders_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
    externalIdIdx: uniqueIndex("orders_client_external_id_uq").on(
      table.clientId,
      table.externalId,
    ),
  }),
);

export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = typeof ordersTable.$inferInsert;

export const orderItemsTable = pgTable(
  "order_items",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    orderId: text("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantity: integer("quantity").notNull(),
    priceAtSale: doublePrecision("price_at_sale").notNull(),
    size: text("size"),
    color: text("color"),
  },
  (table) => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
    productIdx: index("order_items_product_idx").on(table.productId),
  }),
);

export type OrderItem = typeof orderItemsTable.$inferSelect;
export type InsertOrderItem = typeof orderItemsTable.$inferInsert;
