#!/usr/bin/env bash
# Installs what scripts/db/backup.ts and restore.ts need on a GitHub Actions
# Ubuntu runner: the PostgreSQL 17 client (pg_dump must be at least the
# server's version, and the runner's own is older) and age, which encrypts
# the nightly backup. Exports PG_BIN_DIR for later steps. See docs/backups.md.
set -euo pipefail

sudo apt-get update
if ! apt-cache show postgresql-client-17 >/dev/null 2>&1; then
    # The PostgreSQL project's own apt repository (apt.postgresql.org).
    sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
fi
sudo apt-get install --yes --no-install-recommends postgresql-client-17 age

echo "PG_BIN_DIR=/usr/lib/postgresql/17/bin" >> "$GITHUB_ENV"
/usr/lib/postgresql/17/bin/pg_dump --version
age --version
