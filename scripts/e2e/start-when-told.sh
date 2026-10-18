#!/bin/sh
# Runs "$@" (with stdin closed) once a line reading "go" arrives on stdin, and
# exits 1 without running it if stdin closes first. scripts/e2e/run-lock.mjs
# starts its command through this, so the command cannot do anything before
# the lock helper is watching it.
#
#   sh scripts/e2e/start-when-told.sh <command> [args…]
read -r signal && [ "$signal" = go ] && exec "$@" </dev/null
exit 1
