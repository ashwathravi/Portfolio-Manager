import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    backupRunFromEnv,
    compareRestore,
    connectionEnv,
    describeBackup,
    manifestSchema,
    migrationsToRestore,
    pgToolPath,
    readManifest,
    toolMajorVersion,
    type BackupManifest,
    type JournalEntry,
} from './backups';

// Launch item i68: what the nightly backup and the restore check share.

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
    return {
        format: 1,
        createdAt: '2026-10-28T06:41:00.000Z',
        commit: 'abc1234',
        serverVersion: '17.4',
        pgDumpVersion: 'pg_dump (PostgreSQL) 17.6',
        migrations: [{ hash: HASH_A, createdAt: 1000 }, { hash: HASH_B, createdAt: 2000 }],
        tables: { auth_users: 2, holdings: 1234 },
        files: {
            'data.dump': { sha256: HASH_C, bytes: 10 },
            'schema.dump': { sha256: HASH_C, bytes: 20 },
        },
        ...overrides,
    };
}

describe('connectionEnv', () => {
    test('passes a connection string to libpq as environment variables, password included', () => {
        assert.deepEqual(
            connectionEnv('postgresql://postgres.ref:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require'),
            {
                PGHOST: 'aws-0-us-east-1.pooler.supabase.com',
                PGPORT: '5432',
                PGUSER: 'postgres.ref',
                PGPASSWORD: 'p@ss/word',
                PGDATABASE: 'postgres',
                PGSSLMODE: 'require',
            },
        );
    });

    test('defaults the port, leaves out a missing password and unwraps an IPv6 host', () => {
        assert.deepEqual(connectionEnv('postgres://atlas@[::1]/scratch'), {
            PGHOST: '::1',
            PGPORT: '5432',
            PGUSER: 'atlas',
            PGDATABASE: 'scratch',
        });
    });

    test('refuses a parameter it would otherwise drop', () => {
        assert.throws(() => connectionEnv('postgres://u:p@localhost/db?options=-c%20search_path%3Dx'), /don't pass on: options/);
    });

    test('refuses anything that is not a complete postgres URL', () => {
        assert.throws(() => connectionEnv('not a url'), /isn't a URL/);
        assert.throws(() => connectionEnv('mysql://u:p@localhost/db'), /postgres:\/\//);
        assert.throws(() => connectionEnv('postgres://u:p@localhost/'), /a host, a user and a database/);
    });
});

describe('toolMajorVersion', () => {
    test('reads the major version from Debian and Homebrew builds', () => {
        assert.equal(toolMajorVersion('pg_dump (PostgreSQL) 17.6 (Ubuntu 17.6-1.pgdg24.04+1)\n'), 17);
        assert.equal(toolMajorVersion('pg_restore (PostgreSQL) 18.6'), 18);
    });

    test('throws on output without a version', () => {
        assert.throws(() => toolMajorVersion('command not found'), /Couldn't read a PostgreSQL version/);
    });
});

describe('pgToolPath', () => {
    test('uses PG_BIN_DIR when it is set', () => {
        assert.equal(pgToolPath('pg_dump', { PG_BIN_DIR: '/usr/lib/postgresql/17/bin', PATH: '/usr/bin' }, []), '/usr/lib/postgresql/17/bin/pg_dump');
    });

    test('finds the tool on the PATH, then in the Homebrew keg, else says how to install it', () => {
        const onPath = mkdtempSync(join(tmpdir(), 'pg-path-'));
        const keg = mkdtempSync(join(tmpdir(), 'pg-keg-'));
        try {
            writeFileSync(join(onPath, 'pg_restore'), '');
            writeFileSync(join(keg, 'pg_dump'), '');
            assert.equal(pgToolPath('pg_restore', { PATH: `/nowhere:${onPath}` }, [keg]), join(onPath, 'pg_restore'));
            assert.equal(pgToolPath('pg_dump', { PATH: onPath }, [keg]), join(keg, 'pg_dump'));
            assert.throws(() => pgToolPath('pg_restore', { PATH: '/nowhere' }, [keg]), /brew install libpq.*PG_BIN_DIR/);
        } finally {
            rmSync(onPath, { recursive: true, force: true });
            rmSync(keg, { recursive: true, force: true });
        }
    });
});

describe('migrationsToRestore', () => {
    const journal: JournalEntry[] = [
        { idx: 0, when: 1000, tag: '0000_first' },
        { idx: 1, when: 2000, tag: '0001_second' },
        { idx: 2, when: 3000, tag: '0002_newer_than_the_backup' },
    ];
    const hashes: Record<string, string> = { '0000_first': HASH_A, '0001_second': HASH_B, '0002_newer_than_the_backup': HASH_C };
    const hashOf = (tag: string) => hashes[tag];

    test('takes exactly the migrations the backup had applied, not newer ones', () => {
        assert.deepEqual(
            migrationsToRestore(journal, hashOf, manifest().migrations, 'abc1234').map((e) => e.tag),
            ['0000_first', '0001_second'],
        );
    });

    test('refuses a checkout that lacks one of the backup\'s migrations, naming the commit to use', () => {
        const applied = [...manifest().migrations, { hash: HASH_C, createdAt: 3000 }, { hash: HASH_C, createdAt: 4000 }];
        assert.throws(() => migrationsToRestore(journal, hashOf, applied, 'abc1234'), /4 migrations applied and this checkout only has 3\. Check out abc1234/);
    });

    test('refuses a migration whose file changed since the database ran it', () => {
        const edited = (tag: string) => (tag === '0001_second' ? HASH_C : hashOf(tag));
        assert.throws(() => migrationsToRestore(journal, edited, manifest().migrations, null), /Migration 2 in the backup \(recorded at 2000\) isn't 0001_second/);
    });

    test('refuses migrations recorded at other times, even with the same files', () => {
        const applied = [{ hash: HASH_A, createdAt: 1000 }, { hash: HASH_B, createdAt: 2500 }];
        assert.throws(() => migrationsToRestore(journal, hashOf, applied, null), /Migration 2/);
    });
});

describe('compareRestore', () => {
    const restored = () => ({ migrations: manifest().migrations, tables: { auth_users: 2, holdings: 1234 } });

    test('finds nothing when every table and migration matches', () => {
        assert.deepEqual(compareRestore(manifest(), restored()), []);
    });

    test('names each table whose rows differ, or that only one side has', () => {
        assert.deepEqual(compareRestore(manifest(), { ...restored(), tables: { holdings: 1233, order_plans: 0 } }), [
            'Table auth_users is in the backup but not in the restored database.',
            'Table holdings: 1234 rows in the backup, 1233 restored.',
            'Table order_plans is in the restored database but not in the backup.',
        ]);
    });

    test('notices migrations that differ', () => {
        const problems = compareRestore(manifest(), { ...restored(), migrations: manifest().migrations.slice(0, 1) });
        assert.equal(problems.length, 1);
        assert.match(problems[0], /^Migrations: the backup has 2 and the restored database has 1/);
    });
});

describe('describeBackup', () => {
    test('gives totals only, never a table\'s rows', () => {
        assert.equal(describeBackup(manifest()), '2 tables, 1,236 rows, 2 migrations');
    });
});

describe('the manifest', () => {
    test('accepts what the backup writes', () => {
        assert.equal(manifestSchema.safeParse(manifest()).success, true);
    });

    test('refuses another format, a malformed hash, a negative count or an unknown field', () => {
        assert.equal(manifestSchema.safeParse({ ...manifest(), format: 2 }).success, false);
        assert.equal(manifestSchema.safeParse(manifest({ migrations: [{ hash: 'abc', createdAt: 1 }] })).success, false);
        assert.equal(manifestSchema.safeParse(manifest({ tables: { holdings: -1 } })).success, false);
        assert.equal(manifestSchema.safeParse({ ...manifest(), extra: true }).success, false);
    });

    test('is read from the backup directory, which must hold one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'backup-manifest-'));
        try {
            assert.throws(() => readManifest(dir), /No manifest\.json in .*decrypted backup/);
            writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest()));
            assert.deepEqual(readManifest(dir), manifest());
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('backupRunFromEnv (launch item i71)', () => {
    const now = new Date('2026-10-29T07:00:00Z');
    const env = {
        BACKUP_STATUS: 'succeeded',
        BACKUP_STARTED_AT: '2026-10-29T06:52:10Z',
        BACKUP_RUN_URL: 'https://github.com/ashwathravi/Portfolio-Manager/actions/runs/1',
    };

    test('reads the run the workflow describes, finished now', () => {
        assert.deepEqual(backupRunFromEnv(env, now), {
            status: 'succeeded',
            startedAt: new Date('2026-10-29T06:52:10Z'),
            finishedAt: now,
            runUrl: env.BACKUP_RUN_URL,
        });
        assert.equal(backupRunFromEnv({ ...env, BACKUP_STATUS: 'failed', BACKUP_RUN_URL: '' }, now).runUrl, null);
    });

    test('refuses a status, time or link the workflow could only have mistyped', () => {
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_STATUS: 'success' }, now), /BACKUP_STATUS/);
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_STATUS: undefined }, now), /BACKUP_STATUS/);
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_STARTED_AT: '' }, now), /BACKUP_STARTED_AT/);
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_STARTED_AT: 'yesterday' }, now), /BACKUP_STARTED_AT/);
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_STARTED_AT: '2026-10-29T07:00:01Z' }, now), /BACKUP_STARTED_AT/);
        assert.throws(() => backupRunFromEnv({ ...env, BACKUP_RUN_URL: 'javascript:alert(1)' }, now), /BACKUP_RUN_URL/);
    });
});
