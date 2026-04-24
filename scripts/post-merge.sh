#!/bin/bash
set -e
pnpm install --frozen-lockfile
# In dev, push schema changes directly so isolated task envs can pick up new
# tables/columns without manually applying migrations. Production deployments
# should run `pnpm --filter @workspace/db run migrate` against a real database
# instead — see lib/db/migrations/ for the generated SQL files.
pnpm --filter @workspace/db run push-force
pnpm --filter @workspace/api-spec run codegen
