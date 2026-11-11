#!/usr/bin/env bash
# Installs what scripts/db/backup.ts and restore.ts need on a GitHub Actions
# Ubuntu runner: the PostgreSQL 17 client (pg_dump must be at least the
# server's version, and the runner's own is older) and age, which encrypts
# the nightly backup. Exports PG_BIN_DIR for later steps. See docs/backups.md.
#
# A package mirror that stops answering used to hang this step for minutes and
# then fail the night's backup (apt exit code 100). apt now gives up on a
# stuck download after 30 seconds and retries it, and the whole install is
# tried up to three times before the step fails.
set -euo pipefail

APT=(sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

install_tools() {
    "${APT[@]}" update || return 1
    if ! apt-cache show postgresql-client-17 >/dev/null 2>&1; then
        # The PostgreSQL project's own apt repository (apt.postgresql.org).
        sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y || return 1
    fi
    "${APT[@]}" install --yes --no-install-recommends postgresql-client-17 age || return 1
}

attempts=3
for attempt in $(seq 1 "$attempts"); do
    if install_tools; then
        break
    fi
    if [ "$attempt" -eq "$attempts" ]; then
        echo "::error::Couldn't install the PostgreSQL 17 client and age after $attempts tries. See docs/backups.md."
        exit 1
    fi
    echo "::warning::Installing the PostgreSQL 17 client and age failed (try $attempt of $attempts); trying again in 30 seconds."
    sleep 30
done

echo "PG_BIN_DIR=/usr/lib/postgresql/17/bin" >> "$GITHUB_ENV"
/usr/lib/postgresql/17/bin/pg_dump --version
age --version
