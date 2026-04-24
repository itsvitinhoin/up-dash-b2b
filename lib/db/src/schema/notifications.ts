import {
  pgTable,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["ANOMALY", "TOP_MOVER", "SUMMARY", "ALERT"],
    }).notNull(),
    severity: text("severity", { enum: ["INFO", "SUCCESS", "WARNING"] })
      .notNull()
      .default("INFO"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    signalKey: text("signal_key").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clientIdx: index("notifications_client_idx").on(table.clientId),
    clientCreatedIdx: index("notifications_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
    signalUq: uniqueIndex("notifications_signal_uq").on(
      table.clientId,
      table.signalKey,
    ),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
