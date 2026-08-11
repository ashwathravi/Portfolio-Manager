#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This helper requires macOS Keychain.' >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' 'GitHub CLI (gh) is required.' >&2
  exit 1
fi

keychain_service="${ATLAS_WEALTH_KEYCHAIN_SERVICE:-atlas-wealth/DATABASE_URL}"
keychain_account="${ATLAS_WEALTH_KEYCHAIN_ACCOUNT:-${USER}}"
repository="${GITHUB_REPOSITORY:-ashwathravi/Portfolio-Manager}"

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  printf '%s\n' 'GitHub CLI is not authenticated. Run gh auth login first.' >&2
  exit 1
fi

if ! security find-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w >/dev/null 2>&1; then
  printf 'No Keychain item found for %s. Run npm run keychain:store first.\n' "$keychain_service" >&2
  exit 1
fi

secret_args=(secret set DATABASE_URL --repo "$repository")
secret_scope='repository'
if [[ -n "${GITHUB_ENVIRONMENT:-}" ]]; then
  secret_args+=(--env "$GITHUB_ENVIRONMENT")
  secret_scope="environment ${GITHUB_ENVIRONMENT}"
fi

security find-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w | gh "${secret_args[@]}"

printf 'DATABASE_URL synced to GitHub Actions %s secret for %s.\n' "$secret_scope" "$repository"
