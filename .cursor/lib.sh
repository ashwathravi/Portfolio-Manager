# Shared helpers for Atlas Wealth Cloud Agent environment scripts.
# Sourced by install.sh and start.sh. Keep this idempotent and non-interactive.

set -euo pipefail

# Local, throwaway development Postgres cluster owned by the current user.
# Data lives under the home directory so it is captured by environment snapshots
# and writable at runtime without sudo.
export PGDATA="${PGDATA:-$HOME/.pgdata}"
export PGPORT="${PGPORT:-5432}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGDATABASE_APP="${PGDATABASE_APP:-atlas_wealth}"
export PGUSER_APP="${PGUSER_APP:-$(id -un)}"

# Resolve the PostgreSQL bin directory (installed under /usr/lib/postgresql/<ver>/bin).
resolve_pg_bin() {
    if command -v pg_ctl >/dev/null 2>&1; then
        dirname "$(command -v pg_ctl)"
        return 0
    fi
    local candidate
    candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "$candidate" ] && [ -x "$candidate/pg_ctl" ]; then
        echo "$candidate"
        return 0
    fi
    echo "ERROR: could not locate PostgreSQL bin directory. Is postgresql installed?" >&2
    return 1
}

# Resolve the bin directory now if PostgreSQL is already installed. When it is
# not yet installed (fresh base image), this stays empty and install.sh installs
# PostgreSQL and then calls refresh_pg_path. Kept non-fatal so sourcing under
# `set -e` never aborts before the install step has a chance to run.
refresh_pg_path() {
    PG_BIN="$(resolve_pg_bin 2>/dev/null || true)"
    export PG_BIN
    if [ -n "$PG_BIN" ]; then
        export PATH="$PG_BIN:$PATH"
    fi
}

refresh_pg_path

pg_is_running() {
    pg_ctl -D "$PGDATA" status >/dev/null 2>&1
}

start_postgres() {
    if pg_is_running; then
        return 0
    fi
    # Clean up a stale socket/lock from an unclean shutdown before starting.
    rm -f "$PGDATA/postmaster.pid" 2>/dev/null || true
    pg_ctl -D "$PGDATA" \
        -o "-p $PGPORT -c listen_addresses=127.0.0.1 -k /tmp" \
        -l "$PGDATA/server.log" -w -t 60 start
}

wait_for_postgres() {
    for _ in $(seq 1 30); do
        if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "ERROR: PostgreSQL did not become ready on $PGHOST:$PGPORT" >&2
    cat "$PGDATA/server.log" 2>/dev/null || true
    return 1
}
