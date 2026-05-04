import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const productsTable = pgTable(
  "products",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    price: doublePrecision("price").notNull(),
    cost: doublePrecision("cost"),
    stock: integer("stock").notNull().default(0),
    restockThreshold: integer("restock_threshold").notNull().default(10),
    imageUrl: text("image_url"),
    totalSold: integer("total_sold").notNull().default(0),
    totalRevenue: doublePrecision("total_revenue").notNull().default(0),
    status: text("status", { enum: ["ACTIVE", "INACTIVE", "DISCONTINUED"] })
      .notNull()
      .default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientSkuUq: uniqueIndex("products_client_sku_uq").on(
      table.clientId,
      table.sku,
    ),
    clientExternalIdUq: uniqueIndex("products_client_external_id_uq").on(
      table.clientId,
      table.externalId,
    ),
    clientIdx: index("products_client_idx").on(table.clientId),
    categoryIdx: index("products_category_idx").on(table.category),
    clientCreatedIdx: index("products_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
  }),
);

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = typeof productsTable.$inferInsert;
