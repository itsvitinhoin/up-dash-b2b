#!/bin/bash
set -e
pnpm install --frozen-lockfile
# One-time/idempotent: if the DB schema already exists but Drizzle's migration
# ledger doesn't (i.e. it was previously kept in sync via `db push`), pre-mark
# every committed migration as applied so the next step becomes a clean
# fast-forward. Safe to run on every deploy and on fresh DBs.
pnpm --filter @workspace/db run migrate:bootstrap
# Apply pending Drizzle migrations from lib/db/migrations/. Same command for
# dev and prod so the two environments stay in lockstep. Use
# `pnpm --filter @workspace/db run generate` to author a new migration and
# commit it under lib/db/migrations/.
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-spec run codegen
