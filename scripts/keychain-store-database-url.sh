#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This helper requires macOS Keychain.' >&2
  exit 1
fi

keychain_service="${ATLAS_WEALTH_KEYCHAIN_SERVICE:-atlas-wealth/DATABASE_URL}"
keychain_account="${ATLAS_WEALTH_KEYCHAIN_ACCOUNT:-${USER}}"

if ! command -v security >/dev/null 2>&1; then
  printf '%s\n' 'The macOS security command is unavailable.' >&2
  exit 1
fi

printf 'Enter DATABASE_URL for Keychain item %s (input will be hidden):\n' "$keychain_service"
security add-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -U \
  -w

printf 'DATABASE_URL stored in macOS Keychain as %s.\n' "$keychain_service"
