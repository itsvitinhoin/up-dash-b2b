// Idempotent bootstrap: marks each migration as applied in the drizzle
// ledger only when every CREATE TABLE / CREATE INDEX target it declares is
// already present in the live DB. Lets `drizzle-kit migrate` safely cover
// fresh, partial-upgrade, and fully-upgraded databases.
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
  columns: Array<{ table: string; column: string }>;
}

function parseMigrationEffects(sql: string): MigrationEffects {
  const tables: string[] = [];
  const indexes: string[] = [];
  const columns: Array<{ table: string; column: string }> = [];
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  const indexRe = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  const addColRe =
    /alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(sql)) !== null) tables.push(match[1]);
  while ((match = indexRe.exec(sql)) !== null) indexes.push(match[1]);
  while ((match = addColRe.exec(sql)) !== null) {
    columns.push({ table: match[1], column: match[2] });
  }
  return { tables, indexes, columns };
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

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2
     ) as exists`,
    [table, column],
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
      if (
        effects.tables.length === 0 &&
        effects.indexes.length === 0 &&
        effects.columns.length === 0
      ) {
        console.log(
          `[migrate-bootstrap] ${entry.tag}: no detectable effects, leaving for migrate`,
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
      for (const { table, column } of effects.columns) {
        if (!(await columnExists(pool, table, column))) {
          missing.push(`column:${table}.${column}`);
        }
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
