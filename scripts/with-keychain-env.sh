#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  printf 'Usage: %s <command> [args...]\n' "$0" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This helper requires macOS Keychain.' >&2
  exit 1
fi

keychain_service="${ATLAS_WEALTH_KEYCHAIN_SERVICE:-atlas-wealth/DATABASE_URL}"
keychain_account="${ATLAS_WEALTH_KEYCHAIN_ACCOUNT:-${USER}}"

if ! database_url="$(security find-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w 2>/dev/null)"; then
  printf 'No Keychain item found for %s. Run npm run keychain:store first.\n' "$keychain_service" >&2
  exit 1
fi

if [[ -z "$database_url" ]]; then
  printf 'The Keychain item %s is empty.\n' "$keychain_service" >&2
  exit 1
fi

export DATABASE_URL="$database_url"
unset database_url

exec "$@"
