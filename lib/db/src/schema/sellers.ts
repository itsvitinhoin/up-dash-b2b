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

export const sellersTable = pgTable(
  "sellers",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    totalOrders: integer("total_orders").notNull().default(0),
    totalRevenue: doublePrecision("total_revenue").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientEmailUq: uniqueIndex("sellers_client_email_uq").on(
      table.clientId,
      table.email,
    ),
    clientIdx: index("sellers_client_idx").on(table.clientId),
  }),
);

export type Seller = typeof sellersTable.$inferSelect;
export type InsertSeller = typeof sellersTable.$inferInsert;
