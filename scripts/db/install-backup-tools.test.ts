import { after, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Stand-ins on PATH for what install-backup-tools.sh runs on the runner. Every
// call is logged to $STUB_STATE/calls. STUB_FAIL_UPDATES and
// STUB_FAIL_INSTALLS make that many `apt-get update` or `apt-get install`
// calls fail (exit 100, as apt does) before they succeed; STUB_NO_CLIENT=1
// makes Ubuntu's archive lack postgresql-client-17, so apt.postgresql.org is
// added. `sleep` returns at once.
const stubDirectory = mkdtempSync(path.join(tmpdir(), 'backup-tools-stub-'));
const stubs: Record<string, string> = {
    sudo: `#!/bin/bash
echo "sudo $*" >> "$STUB_STATE/calls"
fail_first() {
    local counter="$STUB_STATE/$1" limit="$2" count
    count=$(cat "$counter" 2>/dev/null || echo 0)
    echo $((count + 1)) > "$counter"
    [ "$count" -ge "$limit" ]
}
case " $* " in
    *" update "*) fail_first updates "\${STUB_FAIL_UPDATES:-0}" || exit 100 ;;
    *" install "*) fail_first installs "\${STUB_FAIL_INSTALLS:-0}" || exit 100 ;;
    *apt.postgresql.org.sh*) ;;
    *) echo "unexpected: sudo $*" >&2; exit 2 ;;
esac
`,
    'apt-cache': `#!/bin/bash
echo "apt-cache $*" >> "$STUB_STATE/calls"
[ "\${STUB_NO_CLIENT:-0}" != 1 ]
`,
    sleep: `#!/bin/bash
echo "sleep $*" >> "$STUB_STATE/calls"
`,
};
for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(path.join(stubDirectory, name), body);
    chmodSync(path.join(stubDirectory, name), 0o755);
}
after(() => rmSync(stubDirectory, { recursive: true, force: true }));

// The script ends by exporting PG_BIN_DIR and running the installed pg_dump,
// which only a machine with the PostgreSQL 17 client has. Elsewhere that last
// command fails (its status differs between bash versions), so an install
// that went through is one that got that far without an error.
const PG_DUMP = '/usr/lib/postgresql/17/bin/pg_dump';

function assertInstalled(result: ReturnType<typeof install>) {
    assert.strictEqual(result.githubEnv, 'PG_BIN_DIR=/usr/lib/postgresql/17/bin\n');
    assert.doesNotMatch(result.stdout, /::error::/);
    if (existsSync(PG_DUMP)) assert.strictEqual(result.status, 0, result.stderr);
    else assert.ok(result.stderr.includes(PG_DUMP), result.stderr);
}

function install(stub: Record<string, string> = {}) {
    const state = mkdtempSync(path.join(stubDirectory, 'run-'));
    const githubEnv = path.join(state, 'github-env');
    writeFileSync(githubEnv, '');
    const result = spawnSync('bash', ['scripts/db/install-backup-tools.sh'], {
        env: { ...process.env, PATH: `${stubDirectory}:${process.env.PATH}`, STUB_STATE: state, GITHUB_ENV: githubEnv, ...stub },
        encoding: 'utf8',
    });
    const calls = readFileSync(path.join(state, 'calls'), 'utf8').trim().split('\n');
    return {
        ...result,
        calls,
        updates: calls.filter((call) => call.endsWith(' update')),
        installs: calls.filter((call) => call.includes(' install ')),
        sleeps: calls.filter((call) => call.startsWith('sleep ')),
        githubEnv: readFileSync(githubEnv, 'utf8'),
    };
}

const warning = (attempt: number) => `::warning::Installing the PostgreSQL 17 client and age failed (try ${attempt} of 3); trying again in 30 seconds.`;

describe('install-backup-tools.sh', () => {
    test('installs the PostgreSQL 17 client and age on the first try, with apt retrying stuck downloads', () => {
        const result = install();
        assertInstalled(result);
        assert.deepStrictEqual(result.calls.slice(0, 3), [
            'sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update',
            'apt-cache show postgresql-client-17',
            'sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install --yes --no-install-recommends postgresql-client-17 age',
        ]);
        assert.strictEqual(result.calls.length, 3);
        assert.doesNotMatch(result.stdout, /::warning::/);
    });

    test('adds apt.postgresql.org when Ubuntu has no postgresql-client-17', () => {
        const result = install({ STUB_NO_CLIENT: '1' });
        assertInstalled(result);
        assert.deepStrictEqual(result.calls.filter((call) => call.includes('apt.postgresql.org')), [
            'sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y',
        ]);
        assert.strictEqual(result.installs.length, 1);
    });

    test('tries a failed install again after 30 seconds, from apt-get update', () => {
        const result = install({ STUB_FAIL_INSTALLS: '2' });
        assertInstalled(result);
        assert.strictEqual(result.updates.length, 3);
        assert.strictEqual(result.installs.length, 3);
        assert.deepStrictEqual(result.sleeps, ['sleep 30', 'sleep 30']);
        assert.ok(result.stdout.includes(`${warning(1)}\n${warning(2)}\n`), result.stdout);
    });

    test('tries again when apt-get update fails, without installing from a failed update', () => {
        const result = install({ STUB_FAIL_UPDATES: '1' });
        assertInstalled(result);
        assert.strictEqual(result.updates.length, 2);
        assert.strictEqual(result.installs.length, 1);
        assert.deepStrictEqual(result.sleeps, ['sleep 30']);
        assert.ok(result.stdout.includes(warning(1)), result.stdout);
    });

    test('fails the step after three tries, without waiting after the last one', () => {
        const result = install({ STUB_FAIL_INSTALLS: '3' });
        assert.strictEqual(result.status, 1);
        assert.strictEqual(result.installs.length, 3);
        assert.deepStrictEqual(result.sleeps, ['sleep 30', 'sleep 30']);
        assert.ok(result.stdout.includes(
            `${warning(1)}\n${warning(2)}\n::error::Couldn't install the PostgreSQL 17 client and age after 3 tries. See docs/backups.md.\n`,
        ), result.stdout);
        assert.strictEqual(result.githubEnv, '');
    });
});
