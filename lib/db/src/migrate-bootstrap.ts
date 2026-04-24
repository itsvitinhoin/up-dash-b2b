/**
 * One-time bootstrap for environments whose schema was applied via
 * `drizzle-kit push` (i.e. the dev DB) before the project committed to
 * tracked migrations. Idempotent: safe to run on every deploy.
 *
 * Logic:
 *   1. Ensure the `drizzle.__drizzle_migrations` ledger table exists.
 *   2. For each migration in `migrations/meta/_journal.json`, parse its SQL
 *      to discover the relations it would create (CREATE TABLE / CREATE
 *      INDEX), then verify EVERY one of them is already present in the live
 *      database. Only when all are present is the migration marked as
 *      applied. This makes the bootstrap safe for partial-upgrade scenarios
 *      (e.g. a DB created from an older snapshot that's missing newly-added
 *      tables/columns): such migrations are *not* fast-forwarded so
 *      `drizzle-kit migrate` will still run them.
 *   3. On a fresh DB nothing matches, the ledger stays empty, and migrate
 *      applies everything from scratch.
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

interface MigrationEffects {
  tables: string[];
  indexes: string[];
}

/**
 * Parse a Drizzle-generated migration SQL file and return the names of the
 * tables/indexes it creates. We deliberately ignore ALTER TABLE statements:
 * those add columns/constraints, and our existence check uses the table set
 * to gate marking the migration applied. If any table is missing, the
 * ALTERs would also be missing, so the migration must run fully.
 */
function parseMigrationEffects(sql: string): MigrationEffects {
  const tables: string[] = [];
  const indexes: string[] = [];
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  const indexRe = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(sql)) !== null) tables.push(match[1]);
  while ((match = indexRe.exec(sql)) !== null) indexes.push(match[1]);
  return { tables, indexes };
}

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = $1
     ) as exists`,
    [name],
  );
  return r.rows[0]?.exists ?? false;
}

async function indexExists(pool: Pool, name: string): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from pg_indexes
       where schemaname = 'public' and indexname = $1
     ) as exists`,
    [name],
  );
  return r.rows[0]?.exists ?? false;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url });
  try {
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
    let skipped = 0;
    for (const entry of journal.entries) {
      const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");

      const already = await pool.query(
        `select 1 from drizzle.__drizzle_migrations where hash = $1`,
        [hash],
      );
      if ((already.rowCount ?? 0) > 0) continue;

      const effects = parseMigrationEffects(sql);
      // If a migration creates nothing (rare — ALTER-only), don't pre-mark it:
      // we have no signal to verify it's been applied.
      if (effects.tables.length === 0 && effects.indexes.length === 0) {
        console.log(
          `[migrate-bootstrap] ${entry.tag}: ALTER-only migration, leaving for migrate`,
        );
        skipped += 1;
        continue;
      }

      const missing: string[] = [];
      for (const t of effects.tables) {
        if (!(await tableExists(pool, t))) missing.push(`table:${t}`);
      }
      for (const i of effects.indexes) {
        if (!(await indexExists(pool, i))) missing.push(`index:${i}`);
      }

      if (missing.length > 0) {
        console.log(
          `[migrate-bootstrap] ${entry.tag}: missing ${missing.join(", ")} — leaving for migrate`,
        );
        skipped += 1;
        continue;
      }

      await pool.query(
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
        [hash, entry.when],
      );
      inserted += 1;
      console.log(`[migrate-bootstrap] marked ${entry.tag} as already applied`);
    }
    console.log(
      `[migrate-bootstrap] done: ${inserted} marked applied, ${skipped} left for migrate`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate-bootstrap] failed:", err);
  process.exit(1);
});
