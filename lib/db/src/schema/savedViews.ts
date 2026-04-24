import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { clientsTable } from "./clients";

export const savedViewsTable = pgTable(
  "saved_views",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("saved_views_user_idx").on(table.userId),
    userClientIdx: index("saved_views_user_client_idx").on(
      table.userId,
      table.clientId,
    ),
    nameUq: uniqueIndex("saved_views_user_client_name_uq").on(
      table.userId,
      table.clientId,
      table.name,
    ),
  }),
);

export type SavedView = typeof savedViewsTable.$inferSelect;
export type InsertSavedView = typeof savedViewsTable.$inferInsert;
