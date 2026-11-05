import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SecEdgarError } from '@/lib/sec';

import {
    buildFilersToRefreshQuery,
    buildMarkRefreshedQuery,
    refreshTrackedFilersDaily,
    type DailyRefreshDeps,
} from './daily-refresh';
import type { AlphaRadarRefreshRunResult } from './refresh';

const FILERS = [
    { id: '00000000-0000-4000-8000-00000000000a', name: 'Never checked' },
    { id: '00000000-0000-4000-8000-00000000000b', name: 'Checked last week' },
    { id: '00000000-0000-4000-8000-00000000000c', name: 'Checked yesterday' },
];

function runResult(fields: Partial<AlphaRadarRefreshRunResult> = {}): AlphaRadarRefreshRunResult {
    return {
        scope: 'filer',
        startedAt: '2026-11-04T11:15:00.000Z',
        completedAt: '2026-11-04T11:15:01.000Z',
        totalFilers: 1,
        fetched: 3,
        skipped: 3,
        parsed: 0,
        changed: 0,
        memoGenerated: 0,
        filers: [],
        errors: [],
        ...fields,
    };
}

/** A run against fakes, recording which filers were refreshed and marked. */
function harness(overrides: Partial<DailyRefreshDeps> = {}) {
    const refreshed: string[] = [];
    const marked: Array<{ id: string; at: string }> = [];
    let now = Date.parse('2026-11-04T11:15:00Z');
    const deps: DailyRefreshDeps = {
        userAgent: () => 'Atlas Wealth test contact@example.com',
        listFilers: async () => FILERS,
        refreshFiler: async (id) => {
            refreshed.push(id);
            now += 1_000;
            return runResult();
        },
        markRefreshed: async (id, at) => { marked.push({ id, at: at.toISOString() }); },
        clock: () => now,
        ...overrides,
    };
    return { deps, refreshed, marked, advance: (ms: number) => { now += ms; } };
}

describe('the daily SEC job', () => {
    test('asks SEC nothing, and fails, without SEC_EDGAR_USER_AGENT', async () => {
        let listed = false;
        const { deps, refreshed } = harness({
            userAgent: () => null,
            listFilers: async () => { listed = true; return FILERS; },
        });

        await assert.rejects(refreshTrackedFilersDaily(deps), (error: unknown) => {
            assert.ok(error instanceof SecEdgarError);
            assert.equal(error.code, 'configuration');
            assert.match(error.message, /SEC_EDGAR_USER_AGENT is not set/);
            return true;
        });
        assert.equal(listed, false);
        assert.deepEqual(refreshed, []);
    });

    test('checks every enabled filer in the order given, marking each as checked', async () => {
        const { deps, refreshed, marked } = harness({
            refreshFiler: async (id) => {
                refreshed.push(id);
                return id === FILERS[1].id ? runResult({ parsed: 1, memoGenerated: 1, changed: 12 }) : runResult();
            },
        });

        const detail = await refreshTrackedFilersDaily(deps);

        assert.deepEqual(refreshed, FILERS.map((filer) => filer.id));
        assert.deepEqual(marked.map((mark) => mark.id), FILERS.map((filer) => filer.id));
        assert.deepEqual(detail, { filers: 3, checked: 3, remaining: 0, newFilings: 1, reports: 1, failed: [] });
    });

    test('starts no filer once the budget is spent; the rest go first tomorrow', async () => {
        const { deps, refreshed, marked, advance } = harness({ budgetMs: 60_000 });
        deps.refreshFiler = async (id) => {
            refreshed.push(id);
            advance(45_000);
            return runResult();
        };

        const detail = await refreshTrackedFilersDaily(deps);

        // 45 s in, the second starts; at 90 s the budget is spent.
        assert.deepEqual(refreshed, [FILERS[0].id, FILERS[1].id]);
        assert.deepEqual(marked.map((mark) => mark.id), [FILERS[0].id, FILERS[1].id]);
        assert.equal(detail.checked, 2);
        assert.equal(detail.remaining, 1);
    });

    test('a filer that fails is reported and still marked, so it goes to the back', async () => {
        const { deps, marked } = harness({
            refreshFiler: async (id) => {
                if (id === FILERS[0].id) return runResult({ errors: [{ message: 'SEC request failed: HTTP 503', code: 'http_error' }] });
                if (id === FILERS[1].id) throw new Error('connection reset');
                return runResult();
            },
        });

        const detail = await refreshTrackedFilersDaily(deps);

        assert.deepEqual(marked.map((mark) => mark.id), FILERS.map((filer) => filer.id));
        assert.deepEqual(detail.failed, [
            { filer: 'Never checked', error: 'SEC request failed: HTTP 503' },
            { filer: 'Checked last week', error: 'connection reset' },
        ]);
        assert.equal(detail.checked, 3);
    });

    test('a run in which every filer failed fails, so job health reports it', async () => {
        const { deps, marked } = harness({
            refreshFiler: async () => runResult({ errors: [{ message: 'SEC request failed: HTTP 403', code: 'http_error' }] }),
        });

        await assert.rejects(refreshTrackedFilersDaily(deps), /Every filer checked failed; the first: Never checked: SEC request failed: HTTP 403/);
        assert.equal(marked.length, 3);
    });

    test('long messages are shortened before they are stored with the run', async () => {
        const { deps } = harness({
            listFilers: async () => FILERS.slice(0, 2),
            refreshFiler: async (id) => (id === FILERS[0].id ? runResult({ errors: [{ message: 'x'.repeat(500) }] }) : runResult()),
        });

        const detail = await refreshTrackedFilersDaily(deps);
        const [failure] = detail.failed as Array<{ error: string }>;

        assert.equal(failure.error.length, 200);
        assert.ok(failure.error.endsWith('…'));
    });

    test('no tracked filers is a quiet success', async () => {
        const { deps, refreshed } = harness({ listFilers: async () => [] });

        assert.deepEqual(await refreshTrackedFilersDaily(deps), { filers: 0, checked: 0, remaining: 0, newFilings: 0, reports: 0, failed: [] });
        assert.deepEqual(refreshed, []);
    });

    test('takes enabled filers, the one checked longest ago (or never) first', () => {
        const query = buildFilersToRefreshQuery().toSQL();

        assert.match(query.sql, /where "alpha_radar_tracked_filers"\."enabled" = \$1/);
        assert.match(query.sql, /order by "alpha_radar_tracked_filers"\."last_refreshed_at" asc nulls first, "alpha_radar_tracked_filers"\."name" asc/);
        assert.deepEqual(query.params, [true]);
    });

    test('marks only the check time, leaving the filer otherwise as it was', () => {
        const at = new Date('2026-11-04T11:16:00Z');
        const query = buildMarkRefreshedQuery(FILERS[0].id, at).toSQL();

        assert.match(query.sql, /^update "alpha_radar_tracked_filers" set "last_refreshed_at" = \$1 where "alpha_radar_tracked_filers"\."id" = \$2$/);
        assert.deepEqual(query.params, [at.toISOString(), FILERS[0].id]);
    });
});
