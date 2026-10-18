#!/usr/bin/env bash
# Before docker-compose.yml named the Compose project, Compose named it after
# the checkout's directory. A checkout in a directory not named
# Portfolio-Manager can still have its atlas-wealth-db container, and the data
# volume, under that old project, and Compose would fail to start ours with a
# container name conflict. Stop first and say how to move it over, keeping its
# data. Changes nothing itself. Used by `npm run db:up` and
# scripts/e2e/run-local.sh.
set -euo pipefail

container="atlas-wealth-db"
project="portfolio-manager"
new_volume="${project}_atlas-wealth-db"

# No container, or no Docker (Compose then reports that itself).
owner="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null)" || exit 0
if [[ "$owner" == "$project" ]]; then
    exit 0
fi
old_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$container")"

{
    echo "The $container container belongs to Compose project \"${owner:-none}\", not \"$project\","
    echo "which docker-compose.yml now names, so Compose can't start the database next to it."
    echo
    if docker volume inspect "$new_volume" >/dev/null 2>&1; then
        echo "$new_volume already holds another checkout's database. To use that one"
        echo "(the old data volume, ${old_volume:-none}, stays as it is):"
        echo "  docker rm -f $container && npm run db:up"
    elif [[ -z "$old_volume" ]]; then
        echo "It has no data volume to keep. To replace it:"
        echo "  docker rm -f $container && npm run db:up"
    else
        echo "To move it over, keeping its data ($old_volume stays as it is; remove it"
        echo "once the database looks right):"
        echo "  docker rm -f $container"
        echo "  docker compose up --no-start db"
        echo "  docker run --rm -v $old_volume:/from:ro -v $new_volume:/to postgres:17-alpine cp -a /from/. /to/"
        echo "  npm run db:up"
    fi
} >&2
exit 1
