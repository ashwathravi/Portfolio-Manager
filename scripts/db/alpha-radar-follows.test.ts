import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { buildAccountExport } from '../../src/lib/account/export';
import {
    buildFilersToRefreshQuery,
    buildMarkRefreshedQuery,
    refreshTrackedFilersDaily,
} from '../../src/lib/alpha-radar/daily-refresh';
import { followFiler, listFollowedFilerIds, unfollowFiler } from '../../src/lib/alpha-radar/follows';
import type { AlphaRadarRefreshRunResult } from '../../src/lib/alpha-radar/refresh';

// Launch item i60: the Alpha Radar filers each user follows, and the order
// the daily SEC job checks filers in, against a scratch database with every
// migration applied. Needs a local Postgres it may create databases in; CI's
// e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const BERKSHIRE = '00000000-0000-4000-8000-0000000000b1';
const COATUE = '00000000-0000-4000-8000-0000000000c1';
const PAUSED = '00000000-0000-4000-8000-0000000000d1';
const MISSING = '00000000-0000-4000-8000-0000000000ff';

describe('Alpha Radar follows and the daily SEC job', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `alpha_radar_follows_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<Parameters<typeof followFiler>[2]>;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as typeof database;
        for (const user of ['user-a', 'user-b']) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        }
        await sql`
            INSERT INTO alpha_radar_tracked_filers (id, name, slug, cik, enabled) VALUES
                (${BERKSHIRE}, 'Berkshire Hathaway', 'berkshire', '0001067983', true),
                (${COATUE}, 'Coatue Management', 'coatue', '0000941459', true),
                (${PAUSED}, 'Paused Partners', 'paused', '0000000001', false)`;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    test('a follow is the user\'s own, listed by filer name, and following twice changes nothing', async () => {
        assert.equal(await followFiler('user-a', COATUE, database), true);
        assert.equal(await followFiler('user-a', BERKSHIRE, database), true);
        assert.equal(await followFiler('user-a', BERKSHIRE, database), true);

        assert.deepEqual(await listFollowedFilerIds('user-a', database), [BERKSHIRE, COATUE]);
        assert.deepEqual(await listFollowedFilerIds('user-b', database), []);
        assert.equal((await sql`SELECT count(*)::int AS n FROM alpha_radar_filer_follows`)[0].n, 2);
    });

    test('a filer that doesn\'t exist can\'t be followed', async () => {
        assert.equal(await followFiler('user-b', MISSING, database), false);
        assert.deepEqual(await listFollowedFilerIds('user-b', database), []);
    });

    test('unfollowing touches only that user\'s follow, and again changes nothing', async () => {
        await followFiler('user-b', BERKSHIRE, database);
        await unfollowFiler('user-a', BERKSHIRE, database);
        await unfollowFiler('user-a', BERKSHIRE, database);

        assert.deepEqual(await listFollowedFilerIds('user-a', database), [COATUE]);
        assert.deepEqual(await listFollowedFilerIds('user-b', database), [BERKSHIRE]);
    });

    test('the account export lists the filers followed, by name', async () => {
        const exported = await buildAccountExport('user-a', database);

        assert.equal(exported.alphaRadarFollows.length, 1);
        assert.deepEqual({ ...exported.alphaRadarFollows[0], followedAt: undefined }, { filerId: COATUE, name: 'Coatue Management', followedAt: undefined });
        assert.match(exported.alphaRadarFollows[0].followedAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.deepEqual((await buildAccountExport('user-b', database)).alphaRadarFollows.map((f) => f.name), ['Berkshire Hathaway']);
    });

    test('the daily job takes enabled filers, never checked first, then the one checked longest ago', async () => {
        const order = async () => (await buildFilersToRefreshQuery(database)).map((filer) => filer.name);
        assert.deepEqual(await order(), ['Berkshire Hathaway', 'Coatue Management']);

        await buildMarkRefreshedQuery(BERKSHIRE, new Date('2026-11-04T11:16:00Z'), database);
        assert.deepEqual(await order(), ['Coatue Management', 'Berkshire Hathaway']);

        await buildMarkRefreshedQuery(COATUE, new Date('2026-11-04T11:17:00Z'), database);
        assert.deepEqual(await order(), ['Berkshire Hathaway', 'Coatue Management']);
    });

    test('a run marks each filer it checked, so tomorrow starts with the rest', async () => {
        await sql`UPDATE alpha_radar_tracked_filers SET last_refreshed_at = NULL`;
        const updatedBefore = await sql`SELECT id, updated_at FROM alpha_radar_tracked_filers ORDER BY id`;
        let now = Date.parse('2026-11-05T11:15:00Z');
        const result = (): AlphaRadarRefreshRunResult => ({
            scope: 'filer', startedAt: '', completedAt: '', totalFilers: 1, fetched: 0, skipped: 0,
            parsed: 0, changed: 0, memoGenerated: 0, filers: [], errors: [],
        });

        const detail = await refreshTrackedFilersDaily({
            userAgent: () => 'Atlas Wealth test contact@example.com',
            listFilers: () => buildFilersToRefreshQuery(database),
            refreshFiler: async () => { now += 61_000; return result(); },
            markRefreshed: async (id, at) => { await buildMarkRefreshedQuery(id, at, database); },
            budgetMs: 60_000,
            clock: () => now,
        });

        assert.deepEqual([detail.checked, detail.remaining], [1, 1]);
        const marks = await sql`SELECT name, last_refreshed_at::text AS at FROM alpha_radar_tracked_filers ORDER BY name`;
        assert.deepEqual(marks.map((row) => [row.name, row.at]), [
            ['Berkshire Hathaway', '2026-11-05 11:16:01'],
            ['Coatue Management', null],
            ['Paused Partners', null],
        ]);
        assert.deepEqual((await buildFilersToRefreshQuery(database)).map((filer) => filer.name), ['Coatue Management', 'Berkshire Hathaway']);
        // Checking a filer isn't editing it.
        assert.deepEqual(await sql`SELECT id, updated_at FROM alpha_radar_tracked_filers ORDER BY id`, updatedBefore);
    });

    test('follows go with the account, and with a filer if one is ever removed', async () => {
        await sql`DELETE FROM auth_users WHERE id = 'user-b'`;
        assert.equal((await sql`SELECT count(*)::int AS n FROM alpha_radar_filer_follows WHERE user_id = 'user-b'`)[0].n, 0);
        assert.equal((await sql`SELECT count(*)::int AS n FROM alpha_radar_tracked_filers`)[0].n, 3);

        await sql`DELETE FROM alpha_radar_tracked_filers WHERE id = ${COATUE}`;
        assert.deepEqual(await listFollowedFilerIds('user-a', database), []);
    });
});
