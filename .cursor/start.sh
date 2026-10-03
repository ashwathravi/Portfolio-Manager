#!/usr/bin/env bash
# Per-boot startup for the Atlas Wealth Cloud Agent environment.
# Brings up the local PostgreSQL cluster (idempotently) and returns. The Next.js
# dev server runs as a named terminal, not here.

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=.cursor/lib.sh
source ".cursor/lib.sh"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "WARNING: PostgreSQL data directory $PGDATA is not initialized." >&2
    echo "         Run .cursor/install.sh to bootstrap the database." >&2
    exit 0
fi

echo "==> Starting PostgreSQL"
start_postgres
wait_for_postgres
echo "==> PostgreSQL is ready on ${PGHOST}:${PGPORT}"
