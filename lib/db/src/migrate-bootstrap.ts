/**
 * One-time bootstrap for environments whose schema was applied via
 * `drizzle-kit push` (i.e. the dev DB) before the project committed to
 * tracked migrations. Idempotent: safe to run on every deploy.
 *
 * Logic:
 *   1. Determine whether `public.users` already exists (i.e. some form of the
 *      schema has already been applied via `db push`).
 *   2. Ensure the `drizzle.__drizzle_migrations` ledger table exists.
 *   3. If the schema was already pushed AND the ledger has no entries for the
 *      committed migrations, INSERT a row per entry from
 *      `migrations/meta/_journal.json` so `migrate` becomes a no-op for the
 *      baseline and only runs migrations added later.
 *   4. On a fresh DB the ledger stays empty and `migrate` applies everything
 *      from scratch.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}
interface Journal {
  entries: JournalEntry[];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url });
  try {
    const schemaApplied = await pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'users'
       ) as exists`,
    );
    if (!schemaApplied.rows[0]?.exists) {
      console.log("[migrate-bootstrap] fresh database — leaving for migrate to handle");
      return;
    }

    await pool.query("create schema if not exists drizzle");
    await pool.query(
      `create table if not exists drizzle.__drizzle_migrations (
         id serial primary key,
         hash text not null,
         created_at bigint
       )`,
    );

    const here = dirname(fileURLToPath(import.meta.url));
    const migrationsDir = join(here, "..", "migrations");
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
    ) as Journal;

    let inserted = 0;
    for (const entry of journal.entries) {
      const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const result = await pool.query(
        `insert into drizzle.__drizzle_migrations (hash, created_at)
           select $1::text, $2::bigint
           where not exists (
             select 1 from drizzle.__drizzle_migrations where hash = $1::text
           )`,
        [hash, entry.when],
      );
      if ((result.rowCount ?? 0) > 0) {
        inserted += 1;
        console.log(`[migrate-bootstrap] marked ${entry.tag} as applied`);
      }
    }
    if (inserted === 0) {
      console.log("[migrate-bootstrap] every committed migration is already in the ledger");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate-bootstrap] failed:", err);
  process.exit(1);
});
