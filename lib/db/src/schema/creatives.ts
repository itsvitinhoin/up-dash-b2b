import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const creativesTable = pgTable(
  "creatives",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform", { enum: ["META", "GOOGLE", "TIKTOK"] }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    imageUrl: text("image_url"),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    spend: doublePrecision("spend").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    approvedLeads: integer("approved_leads").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("creatives_client_idx").on(table.clientId),
    clientCreatedIdx: index("creatives_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
  }),
);

export type Creative = typeof creativesTable.$inferSelect;
export type InsertCreative = typeof creativesTable.$inferInsert;
