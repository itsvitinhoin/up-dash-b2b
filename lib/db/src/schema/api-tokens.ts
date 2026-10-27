import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

// Tokens de API de admin: não vencem, mas podem ser desligados (revokedAt) a qualquer momento.
// O valor do token NUNCA fica no banco, só o hash (sha256). `tokenPrefix` (ex.: "upk_ab12cd") é só para o admin reconhecer qual é qual.
export const apiTokensTable = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    // READ = só GET/HEAD (para scripts que apenas consultam); FULL = tudo que o admin pode fazer, menos gerenciar tokens.
    scope: text("scope", { enum: ["FULL", "READ"] }).notNull().default("FULL"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("api_tokens_user_idx").on(table.userId),
  }),
);

export type ApiToken = typeof apiTokensTable.$inferSelect;
export type InsertApiToken = typeof apiTokensTable.$inferInsert;
