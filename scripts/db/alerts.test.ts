import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { ALERTS_JOB, evaluateAlertRules, recordFirings } from '../../src/lib/alerts/nightly';
import { clearAlertNotifications, loadAlertFeed, markAlertNotificationsRead } from '../../src/lib/alerts/server/notifications';
import { AlertRuleLimitError, createAlertRule, deleteAlertRule, listAlertRules, updateAlertRule } from '../../src/lib/alerts/server/rules';
import { ALERT_RULES_PER_USER, alertRuleInputSchema } from '../../src/lib/validators/alerts';

// Launch item i57: alert rules and their notifications kept with the
// account, and the nightly job that evaluates them, against a scratch
// database with every migration applied. Needs a local Postgres it may
// create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const SESSION = '2026-11-02';
const EVENING = new Date('2026-11-02T22:35:00.000Z');

const rule = (overrides: Record<string, unknown> = {}) => alertRuleInputSchema.parse({
    name: 'AAPL above $200', metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 200, enabled: true, rearm: 'daily', ...overrides,
});

describe('alerts kept with the account', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `alerts_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<Parameters<typeof evaluateAlertRules>[0]>['database'] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema });
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    beforeEach(async () => {
        await sql`TRUNCATE auth_users, securities, alpha_radar_tracked_filers, job_runs CASCADE`;
        for (const user of ['u-1', 'u-2']) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        }
    });

    async function closes(symbol: string, bars: [string, number][]) {
        await sql`INSERT INTO securities (symbol) VALUES (${symbol}) ON CONFLICT DO NOTHING`;
        for (const [date, close] of bars) {
            await sql`INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source) VALUES (${symbol}, ${date}, ${close}, ${close}, ${close}, ${close}, 1000, 'test')`;
        }
    }

    /** The latest price run's split check of held positions, as price-ingest.ts records it. */
    async function splitsChecked(through: string, unadjusted: { symbol: string; executionDate: string }[] = []) {
        await sql`INSERT INTO job_runs (job, started_at, finished_at, status, detail) VALUES ('prices', ${`${through}T22:31:00Z`}, ${`${through}T22:33:00Z`}, 'succeeded',
            ${JSON.stringify({ holdingSplits: { from: '2026-10-01', to: through, ...(unadjusted.length > 0 ? { unadjusted } : {}) } })}::jsonb)`;
    }

    async function notifications(user: string) {
        return sql<{ rule_name: string; occurrence: string; observed_value: number; message: string }[]>`
            SELECT rule_name, occurrence, observed_value, message FROM alert_notifications WHERE user_id = ${user} ORDER BY rule_name, occurrence`;
    }

    test('rules are the user\'s own: another user can\'t see, change or delete them', async () => {
        const created = await createAlertRule('u-1', rule(), { database, now: EVENING });
        assert.equal(created.symbol, 'AAPL');
        assert.equal(created.source, 'market');
        assert.deepEqual((await listAlertRules('u-1', database)).map((r) => r.id), [created.id]);
        assert.deepEqual(await listAlertRules('u-2', database), []);

        assert.equal(await updateAlertRule('u-2', created.id, rule({ threshold: 1 }), { database }), null);
        assert.equal(await deleteAlertRule('u-2', created.id, database), false);
        assert.equal((await listAlertRules('u-1', database))[0].threshold, 200);

        const updated = await updateAlertRule('u-1', created.id, rule({ metric: 'portfolio_value', threshold: 5000, enabled: false }), { database });
        assert.deepEqual([updated?.metric, updated?.symbol, updated?.threshold, updated?.enabled], ['portfolio_value', undefined, 5000, false]);
        assert.equal(await deleteAlertRule('u-1', created.id, database), true);
        assert.deepEqual(await listAlertRules('u-1', database), []);
    });

    test('a rule\'s symbol is tracked, so the nightly price job prices it', async () => {
        await createAlertRule('u-1', rule({ symbol: 'NVDA' }), { database });
        assert.equal((await sql`SELECT 1 FROM securities WHERE symbol = 'NVDA'`).length, 1);
    });

    test(`an account has at most ${ALERT_RULES_PER_USER} rules`, async () => {
        await Promise.all(Array.from({ length: ALERT_RULES_PER_USER }, (_, i) => createAlertRule('u-1', rule({ name: `Rule ${i}` }), { database })));
        await assert.rejects(createAlertRule('u-1', rule({ name: 'One more' }), { database }), AlertRuleLimitError);
        await createAlertRule('u-2', rule(), { database });
    });

    test('the database keeps a rule\'s symbol with the metrics that use one, and a notification with its rule\'s owner', async () => {
        await assert.rejects(sql`INSERT INTO alert_rules (user_id, name, metric, comparator, threshold, rearm) VALUES ('u-1', 'x', 'price', 'gte', 1, 'daily')`);
        await assert.rejects(sql`INSERT INTO alert_rules (user_id, name, metric, symbol, comparator, threshold, rearm) VALUES ('u-1', 'x', 'portfolio_value', 'AAPL', 'gte', 1, 'daily')`);
        const created = await createAlertRule('u-1', rule(), { database });
        await assert.rejects(sql`
            INSERT INTO alert_notifications (user_id, rule_id, occurrence, rule_name, metric, comparator, threshold, observed_value, message)
            VALUES ('u-2', ${created.id}, 'session:x', 'x', 'price', 'gte', 1, 1, 'x')`);
    });

    test('the nightly job raises what holds on the session\'s closes, once, and pauses a rule set to fire once', async () => {
        await closes('AAPL', [['2026-10-30', 200], [SESSION, 210]]);
        await closes('MSFT', [['2026-10-30', 400]]);
        const [portfolio] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name, cash_balance) VALUES ('u-1', 'Brokerage', 1000) RETURNING id`;
        await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES (${portfolio.id}, 'AAPL', 'Apple', 10, 150)`;
        await splitsChecked(SESSION);

        await createAlertRule('u-1', rule(), { database });
        await createAlertRule('u-1', rule({ name: 'AAPL up 5%', metric: 'price_change_pct', threshold: 0.05, rearm: 'once' }), { database });
        await createAlertRule('u-1', rule({ name: 'Worth $3k', metric: 'portfolio_value', comparator: 'gte', threshold: 3000 }), { database });
        await createAlertRule('u-1', rule({ name: 'MSFT above $1', symbol: 'MSFT', threshold: 1 }), { database });
        await createAlertRule('u-1', rule({ name: 'Paused', threshold: 1, enabled: false }), { database });
        await createAlertRule('u-2', rule({ name: 'Not yet', threshold: 300 }), { database });

        assert.deepEqual(await evaluateAlertRules({ database, now: EVENING }), { session: SESSION, rules: 5, fired: 3, pruned: 0, accountsWaiting: 0 });
        assert.deepEqual((await notifications('u-1')).map((n) => [n.rule_name, n.occurrence, n.message]), [
            ['AAPL above $200', 'session:2026-11-02', 'AAPL closed at $210.00 on Nov 2, at or above $200.00.'],
            ['AAPL up 5%', 'session:2026-11-02', 'AAPL moved +5.00% on Nov 2, at or above +5.00%.'],
            ['Worth $3k', 'session:2026-11-02', 'Your accounts were worth $3,100.00 at the Nov 2 close, at or above $3,000.00.'],
        ]);
        assert.deepEqual([...await notifications('u-2')], []);
        const rules = await listAlertRules('u-1', database);
        assert.equal(rules.find((r) => r.name === 'AAPL up 5%')?.enabled, false);
        assert.equal(rules.find((r) => r.name === 'AAPL above $200')?.lastTriggeredAt, EVENING.toISOString());
        assert.equal(rules.find((r) => r.name === 'MSFT above $1')?.lastTriggeredAt, undefined);

        // The same evening again: nothing new.
        assert.equal((await evaluateAlertRules({ database, now: new Date(EVENING.getTime() + 60_000) })).fired, 0);
        assert.equal((await notifications('u-1')).length, 3);
    });

    test('regression: a cleared alert isn\'t raised again by a rerun or a market holiday; the next session raises it', async () => {
        // The Codex finding on PR #185: clearing deleted the only record of what fired.
        await closes('AAPL', [['2026-10-30', 200], [SESSION, 210]]);
        const created = await createAlertRule('u-1', rule(), { database });
        assert.equal((await evaluateAlertRules({ database, now: EVENING })).fired, 1);
        await clearAlertNotifications('u-1', { database });
        // A holiday: the cron runs, the newest session is still Nov 2.
        assert.equal((await evaluateAlertRules({ database, now: new Date('2026-11-03T22:35:00.000Z') })).fired, 0);
        assert.equal((await loadAlertFeed('u-1', database)).notifications.length, 0);
        await closes('AAPL', [['2026-11-04', 212]]);
        assert.equal((await evaluateAlertRules({ database, now: new Date('2026-11-04T22:35:00.000Z') })).fired, 1);
        assert.deepEqual((await loadAlertFeed('u-1', database)).notifications.map((n) => [n.ruleId, n.message]), [
            [created.id, 'AAPL closed at $212.00 on Nov 4, at or above $200.00.'],
        ]);
    });

    test('regression: accounts rules wait for split adjustments, so old share counts at post-split prices raise nothing', async () => {
        // The Codex finding on PR #185: NVDA split 10-for-1 on Nov 2; its stored closes are post-split.
        await closes('NVDA', [['2026-10-30', 14], [SESSION, 15]]);
        const holdIn = async (user: string, quantity: number, updatedAt: string) => {
            const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name, cash_balance) VALUES (${user}, 'Brokerage', 0) RETURNING id`;
            await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost, updated_at) VALUES (${p.id}, 'NVDA', 'NVIDIA', ${quantity}, 10, ${updatedAt})`;
        };
        await holdIn('u-1', 10, '2026-10-30 15:00'); // still 10 pre-split shares: worth $1,500, not $150
        await holdIn('u-2', 100, '2026-11-03 15:00'); // re-imported after the split
        // u-1's would fire falsely on 10 × $15; u-2's fires truly on 100 × $15.
        await createAlertRule('u-1', rule({ name: 'Under $500', metric: 'portfolio_value', comparator: 'lt', threshold: 500 }), { database });
        await createAlertRule('u-2', rule({ name: 'Over $1,000', metric: 'portfolio_value', comparator: 'gte', threshold: 1000 }), { database });
        await createAlertRule('u-1', rule({ name: 'NVDA above $1', symbol: 'NVDA', threshold: 1 }), { database });

        // The price run hasn't checked held positions through Nov 2: every accounts rule waits; prices don't.
        await splitsChecked('2026-10-30');
        assert.deepEqual(await evaluateAlertRules({ database, now: EVENING }), {
            session: SESSION, rules: 3, fired: 1, pruned: 0, accountsWaiting: 2,
            splitCheck: 'held positions haven\'t been checked against splits through the latest close',
        });
        assert.deepEqual((await notifications('u-1')).map((n) => n.rule_name), ['NVDA above $1']);

        // Checked, with u-1's position from before the split it couldn't apply: u-1 waits, u-2 is valued.
        await splitsChecked(SESSION, [{ symbol: 'NVDA', executionDate: SESSION }]);
        const detail = await evaluateAlertRules({ database, now: new Date(EVENING.getTime() + 60_000) });
        assert.equal(detail.accountsWaiting, 1);
        assert.equal(detail.splitCheck, undefined);
        assert.deepEqual((await notifications('u-1')).map((n) => n.rule_name), ['NVDA above $1']);
        assert.deepEqual((await notifications('u-2')).map((n) => n.message), ['Your accounts were worth $1,500.00 at the Nov 2 close, at or above $1,000.00.']);
    });

    test('regression: a rule deleted or paused after the job read the rules raises nothing, and doesn\'t fail the others', async () => {
        // The Codex finding on PR #185: the rule foreign key failed the whole batch.
        const kept = await createAlertRule('u-1', rule(), { database });
        const deleted = await createAlertRule('u-2', rule(), { database });
        const paused = await createAlertRule('u-2', rule({ name: 'Paused since' }), { database });
        await deleteAlertRule('u-2', deleted.id, database);
        await updateAlertRule('u-2', paused.id, rule({ name: 'Paused since', enabled: false }), { database });
        const firing = (ruleId: string, userId: string) => ({
            ruleId, userId, occurrence: `session:${SESSION}`, ruleName: 'AAPL above $200', metric: 'price' as const, symbol: 'AAPL',
            comparator: 'gte' as const, threshold: 200, observedValue: 210, message: 'AAPL closed at $210.00.', href: null,
        });
        assert.equal(await recordFirings([firing(deleted.id, 'u-2'), firing(paused.id, 'u-2'), firing(kept.id, 'u-1')], EVENING, database), 1);
        assert.deepEqual((await notifications('u-1')).map((n) => n.occurrence), [`session:${SESSION}`]);
        assert.deepEqual([...await notifications('u-2')], []);
    });

    test('the user\'s notification settings turn a kind of alert off', async () => {
        await closes('AAPL', [['2026-10-30', 200], [SESSION, 210]]);
        await createAlertRule('u-1', rule(), { database });
        await sql`INSERT INTO user_settings (user_id, version, settings) VALUES ('u-1', 16, ${JSON.stringify({ notifications: { portfolioUpdates: true, priceAlerts: false, alphaRadarSignals: true, strategySignals: false, accountSync: true, weeklySummary: true } })}::jsonb)`;
        assert.equal((await evaluateAlertRules({ database, now: EVENING })).fired, 0);
    });

    test('Alpha Radar rules fire on changes stored since the last run, with the user\'s own overlap', async () => {
        const [filer] = await sql<{ id: string }[]>`INSERT INTO alpha_radar_tracked_filers (name, slug, cik) VALUES ('Berkshire Hathaway', 'berkshire', '0001067983') RETURNING id`;
        await sql`INSERT INTO watchlist_items (user_id, id, ticker, company_name, reason, notes, added_at) VALUES ('u-1', 'w-1', 'CB', 'Chubb', '', '', '2026-10-01')`;
        await createAlertRule('u-1', rule({ name: 'On my lists', metric: 'alpha_radar_user_overlap', threshold: 50, rearm: 'always' }), { database, now: new Date('2026-10-01T00:00:00Z') });
        await createAlertRule('u-2', rule({ name: 'On my lists', metric: 'alpha_radar_user_overlap', threshold: 50, rearm: 'always' }), { database, now: new Date('2026-10-01T00:00:00Z') });
        const change = (cusip: string, ticker: string, createdAt: string) => sql`
            INSERT INTO alpha_radar_holding_changes (tracked_filer_id, report_period, change_type, issuer_name, cusip, ticker, materiality_score, created_at)
            VALUES (${filer.id}, '2026-Q3', 'new', ${ticker}, ${cusip}, ${ticker}, 90, ${createdAt})`;
        const occurrences = async () => (await sql<{ occurrence: string }[]>`SELECT occurrence FROM alert_notifications WHERE user_id = 'u-1' ORDER BY occurrence`).map((r) => r.occurrence);
        await change('171232101', 'CB', '2026-11-02 15:00');

        await evaluateAlertRules({ database, now: EVENING });
        assert.deepEqual((await notifications('u-1')).map((n) => n.message), [
            'Berkshire Hathaway opened a new position in CB (CB) in 2026-Q3. Materiality 90/100. It\'s on your watchlist.',
        ]);
        assert.deepEqual([...await notifications('u-2')], []);

        // The run is recorded; a change stored after it is the next run's.
        await sql`INSERT INTO job_runs (job, started_at, finished_at, status) VALUES (${ALERTS_JOB}, ${EVENING.toISOString()}, ${EVENING.toISOString()}, 'succeeded')`;
        await change('X2', 'CB2', '2026-11-03 15:00');
        await sql`INSERT INTO watchlist_items (user_id, id, ticker, company_name, reason, notes, added_at) VALUES ('u-1', 'w-2', 'CB2', '', '', '', '2026-10-01')`;
        await evaluateAlertRules({ database, now: new Date('2026-11-03T22:35:00.000Z') });
        assert.deepEqual(await occurrences(), [
            `change:${filer.id}:2026-Q3:unknown-filing:171232101:new`,
            `change:${filer.id}:2026-Q3:unknown-filing:X2:new`,
        ]);

        // A refresh stores the period's changes anew; nothing is raised twice, even after clearing.
        await clearAlertNotifications('u-1', { database });
        await sql`INSERT INTO job_runs (job, started_at, finished_at, status) VALUES (${ALERTS_JOB}, '2026-11-03T22:35:00Z', '2026-11-03T22:35:00Z', 'succeeded')`;
        await sql`DELETE FROM alpha_radar_holding_changes WHERE tracked_filer_id = ${filer.id}`;
        await change('171232101', 'CB', '2026-11-04 15:00');
        await change('X2', 'CB2', '2026-11-04 15:00');
        assert.equal((await evaluateAlertRules({ database, now: new Date('2026-11-04T22:35:00.000Z') })).fired, 0);
    });

    test('the feed: newest first, read one or all, others\' IDs ignored, cleared; old alerts pruned', async () => {
        const mine = await createAlertRule('u-1', rule(), { database });
        const theirs = await createAlertRule('u-2', rule(), { database });
        const raise = async (user: string, ruleId: string, occurrence: string, at: string) => {
            const [row] = await sql<{ id: string }[]>`
                INSERT INTO alert_notifications (user_id, rule_id, occurrence, rule_name, metric, symbol, comparator, threshold, observed_value, message, triggered_at)
                VALUES (${user}, ${ruleId}, ${occurrence}, 'AAPL above $200', 'price', 'AAPL', 'gte', 200, 210, ${`Raised ${occurrence}`}, ${at}) RETURNING id`;
            return row.id;
        };
        const older = await raise('u-1', mine.id, 'session:2026-10-30', '2026-10-30 22:35');
        const newer = await raise('u-1', mine.id, 'session:2026-11-02', '2026-11-02 22:35');
        const ancient = await raise('u-1', mine.id, 'session:2026-01-02', '2026-01-02 22:35');
        const others = await raise('u-2', theirs.id, 'session:2026-11-02', '2026-11-02 22:35');

        let feed = await loadAlertFeed('u-1', database);
        assert.deepEqual(feed.notifications.map((n) => n.id), [newer, older, ancient]);
        assert.equal(feed.unread, 3);
        assert.deepEqual(feed.notifications[0], {
            id: newer, ruleId: mine.id, ruleName: 'AAPL above $200', metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 200,
            observedValue: 210, triggeredAt: '2026-11-02T22:35:00.000Z', acknowledged: false, source: 'market', message: 'Raised session:2026-11-02',
        });

        await markAlertNotificationsRead('u-1', { ids: [older, others] }, { database });
        feed = await loadAlertFeed('u-1', database);
        assert.deepEqual(feed.notifications.map((n) => n.acknowledged), [false, true, false]);
        assert.equal((await loadAlertFeed('u-2', database)).unread, 1);
        await markAlertNotificationsRead('u-1', { all: true }, { database });
        assert.equal((await loadAlertFeed('u-1', database)).unread, 0);
        assert.equal((await loadAlertFeed('u-2', database)).unread, 1);

        assert.equal((await evaluateAlertRules({ database, now: EVENING })).pruned, 1);
        assert.deepEqual((await loadAlertFeed('u-1', database)).notifications.map((n) => n.id), [newer, older]);

        await clearAlertNotifications('u-1', { database });
        assert.deepEqual((await loadAlertFeed('u-1', database)).notifications, []);
        // Each keeps only which rule fired for what.
        assert.deepEqual([...await sql`SELECT occurrence, message, href, read_at IS NOT NULL AS read FROM alert_notifications WHERE user_id = 'u-1' ORDER BY occurrence`], [
            { occurrence: 'session:2026-10-30', message: '', href: null, read: true },
            { occurrence: 'session:2026-11-02', message: '', href: null, read: true },
        ]);
        assert.equal((await loadAlertFeed('u-2', database)).notifications.length, 1);
        assert.equal((await listAlertRules('u-1', database)).length, 1);

        // Deleting a rule deletes what it raised.
        await deleteAlertRule('u-2', theirs.id, database);
        assert.equal((await loadAlertFeed('u-2', database)).notifications.length, 0);
    });
});
