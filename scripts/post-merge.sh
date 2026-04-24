#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
pnpm --filter @workspace/api-spec run codegen
