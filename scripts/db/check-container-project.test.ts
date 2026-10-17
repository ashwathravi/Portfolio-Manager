import { after, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A stand-in `docker` on PATH: STUB_CONTAINER=1 makes atlas-wealth-db exist,
// owned by STUB_PROJECT with STUB_OLD_VOLUME as its data volume, and
// STUB_NEW_VOLUME=1 makes portfolio-manager_atlas-wealth-db exist.
const stubDirectory = mkdtempSync(path.join(tmpdir(), 'docker-stub-'));
writeFileSync(path.join(stubDirectory, 'docker'), `#!/bin/sh
case "$1 $2" in
    "inspect --format")
        [ "$STUB_CONTAINER" = 1 ] || exit 1
        case "$3" in
            *compose.project*) echo "$STUB_PROJECT" ;;
            *Mounts*) echo "$STUB_OLD_VOLUME" ;;
        esac ;;
    "volume inspect") [ "$STUB_NEW_VOLUME" = 1 ] ;;
    *) echo "unexpected: docker $*" >&2; exit 2 ;;
esac
`);
chmodSync(path.join(stubDirectory, 'docker'), 0o755);
after(() => rmSync(stubDirectory, { recursive: true, force: true }));

function check(stub: Record<string, string>) {
    return spawnSync('bash', ['scripts/db/check-container-project.sh'], {
        env: { ...process.env, PATH: `${stubDirectory}:${process.env.PATH}`, ...stub },
        encoding: 'utf8',
    });
}

describe('check-container-project.sh', () => {
    test('passes when there is no atlas-wealth-db container yet', () => {
        const result = check({});
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stderr, '');
    });

    test('passes when the container belongs to the portfolio-manager project', () => {
        const result = check({ STUB_CONTAINER: '1', STUB_PROJECT: 'portfolio-manager', STUB_OLD_VOLUME: 'portfolio-manager_atlas-wealth-db' });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stderr, '');
    });

    test('stops on a container from the old directory-named project and says how to move its data over', () => {
        const result = check({ STUB_CONTAINER: '1', STUB_PROJECT: 'atlas-wealth', STUB_OLD_VOLUME: 'atlas-wealth_atlas-wealth-db' });
        assert.strictEqual(result.status, 1);
        assert.match(result.stderr, /belongs to Compose project "atlas-wealth", not "portfolio-manager"/);
        assert.ok(result.stderr.includes([
            '  docker rm -f atlas-wealth-db',
            '  docker compose up --no-start db',
            '  docker run --rm -v atlas-wealth_atlas-wealth-db:/from:ro -v portfolio-manager_atlas-wealth-db:/to postgres:17-alpine cp -a /from/. /to/',
            '  npm run db:up',
        ].join('\n')), result.stderr);
    });

    test('never suggests copying over a portfolio-manager volume that already exists', () => {
        const result = check({ STUB_CONTAINER: '1', STUB_PROJECT: 'atlas-wealth', STUB_OLD_VOLUME: 'atlas-wealth_atlas-wealth-db', STUB_NEW_VOLUME: '1' });
        assert.strictEqual(result.status, 1);
        assert.match(result.stderr, /portfolio-manager_atlas-wealth-db already holds another checkout's database/);
        assert.match(result.stderr, /docker rm -f atlas-wealth-db && npm run db:up/);
        assert.doesNotMatch(result.stderr, /cp -a/);
    });
});
