import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const syncJobsTable = pgTable(
  "sync_jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    jobType: text("job_type", {
      enum: ["upzero_transactional", "upzero_analytics", "meta_ads"],
    })
      .notNull()
      .default("upzero_transactional"),
    trigger: text("trigger", {
      enum: ["manual", "cron"],
    })
      .notNull()
      .default("manual"),
    scope: text("scope").notNull().default("client"),
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("sync_jobs_client_idx").on(table.clientId),
    statusIdx: index("sync_jobs_status_idx").on(table.status),
    typeIdx: index("sync_jobs_type_idx").on(table.jobType),
    triggerIdx: index("sync_jobs_trigger_idx").on(table.trigger),
    createdAtIdx: index("sync_jobs_created_at_idx").on(table.createdAt),
  }),
);

export type SyncJob = typeof syncJobsTable.$inferSelect;
export type InsertSyncJob = typeof syncJobsTable.$inferInsert;
