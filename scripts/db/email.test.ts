import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { EmailJobError, sendScheduledEmails, type EmailJobDeps } from '../../src/lib/email/nightly';
import { loadEmailPreferences, saveEmailPreferences, unsubscribe } from '../../src/lib/email/preferences';
import type { OutgoingEmail } from '../../src/lib/email/resend';
import type { TradeJournal } from '../../src/lib/journal/trades';
import type { JournalEntry } from '../../src/types/trade';

// Launch item i58: which emails each user gets, unsubscribing by a link's
// token, and the nightly email job, against a scratch database with every
// migration applied. Resend is faked. Needs a local Postgres it may create
// databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const ENV = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Atlas Wealth <alerts@mail.example.test>', APP_URL: 'https://atlas.example.test' };
// Monday Nov 2, 2026, 5:35 PM EST: the nightly run.
const MONDAY = new Date('2026-11-02T22:35:00.000Z');
// Friday Oct 30, 6:35 PM EDT: the week of Oct 26 has closed.
const FRIDAY = new Date('2026-10-30T22:35:00.000Z');

function entry(id: string, closedAt: string, realizedPnlUsd: number): JournalEntry {
    return {
        id, ticker: 'AAPL', side: 'sell', quantity: 10, entryPrice: 150, exitPrice: 150 + realizedPnlUsd / 10,
        notionalUsd: 1500, realizedPnlUsd, holdingPeriodDays: 20, openedAt: '2026-10-01T15:00:00.000Z', closedAt,
    } as JournalEntry;
}

/** A week of closed trades: two in the week of Oct 26, one the week before. */
const WEEK_TRADES: TradeJournal = {
    entries: [
        entry('t-1', '2026-10-27T15:00:00.000Z', 400),
        entry('t-2', '2026-10-30T19:00:00.000Z', -100),
        entry('t-old', '2026-10-20T15:00:00.000Z', 5_000), // the week before
    ],
    leftOut: ['NVDA'],
    netWorth: 100_000,
};

describe('email kept with the account, and the nightly email job', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `email_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<EmailJobDeps['database']>;

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
        await sql`TRUNCATE auth_users CASCADE`;
        for (const user of ['u-1', 'u-2', 'u-3']) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        }
    });

    async function tokenOf(user: string): Promise<string> {
        const [row] = await sql<{ unsubscribe_token: string }[]>`SELECT unsubscribe_token FROM email_preferences WHERE user_id = ${user}`;
        return row.unsubscribe_token;
    }

    let ruleSeq = 0;
    /** An alert as the alerts job records it. */
    async function raise(user: string, triggeredAt: string, fields: { message?: string; readAt?: string; cleared?: boolean } = {}) {
        ruleSeq += 1;
        const [rule] = await sql<{ id: string }[]>`
            INSERT INTO alert_rules (user_id, name, metric, symbol, comparator, threshold, rearm)
            VALUES (${user}, ${`Rule ${ruleSeq}`}, 'price', 'AAPL', 'gte', 200, 'daily') RETURNING id`;
        const [alert] = await sql<{ id: string }[]>`
            INSERT INTO alert_notifications (user_id, rule_id, occurrence, rule_name, metric, symbol, comparator, threshold, observed_value, message, href, triggered_at, read_at, cleared)
            VALUES (${user}, ${rule.id}, ${`session:${ruleSeq}`}, ${`Rule ${ruleSeq}`}, 'price', 'AAPL', 'gte', 200, 210,
                    ${fields.message ?? `Alert ${ruleSeq}.`}, '/portfolios/detail/AAPL', ${triggeredAt}, ${fields.readAt ?? null}, ${fields.cleared ?? false})
            RETURNING id`;
        return alert.id;
    }

    /** When the alert was emailed, as "YYYY-MM-DDTHH:MI" UTC, or null. */
    async function emailedAt(id: string): Promise<string | null> {
        const [row] = await sql<{ at: string | null }[]>`SELECT to_char(emailed_at, 'YYYY-MM-DD"T"HH24:MI') AS at FROM alert_notifications WHERE id = ${id}`;
        return row.at;
    }

    /** A fake Resend: records what it's given; fails for the addresses named. */
    function outbox(failFor: string[] = []) {
        const sent: OutgoingEmail[] = [];
        const send = async (email: OutgoingEmail) => {
            if (failFor.includes(email.to)) throw new Error(`Resend refused the email (HTTP 500).`);
            sent.push(email);
            return { id: `email-${sent.length}` };
        };
        return { sent, send };
    }

    const run = (now: Date, deps: Partial<EmailJobDeps> = {}) => sendScheduledEmails({
        now, database, env: ENV, pause: async () => {}, loadJournal: async () => ({ entries: [], leftOut: [], netWorth: 0 }), ...deps,
    });

    describe('preferences', () => {
        test('both off before any choice; a save keeps one switch and leaves the other, with a token for the links', async () => {
            assert.deepEqual(await loadEmailPreferences('u-1', database), { alerts: false, weeklyReview: false, address: 'u-1@example.test' });

            assert.deepEqual(await saveEmailPreferences('u-1', { weeklyReview: true }, { database }), { alerts: false, weeklyReview: true });
            assert.deepEqual(await saveEmailPreferences('u-1', { alerts: true }, { database }), { alerts: true, weeklyReview: true });
            assert.deepEqual(await loadEmailPreferences('u-1', database), { alerts: true, weeklyReview: true, address: 'u-1@example.test' });
            assert.match(await tokenOf('u-1'), /^[A-Za-z0-9_-]{43}$/);
            assert.deepEqual(await loadEmailPreferences('u-2', database), { alerts: false, weeklyReview: false, address: 'u-2@example.test' });
        });

        test('turning alert emails on starts them then; saving them on again doesn\'t move the start, and the token stays', async () => {
            const since = async () => (await sql<{ since: string }[]>`SELECT to_char(alerts_since, 'YYYY-MM-DD"T"HH24:MI') AS since FROM email_preferences WHERE user_id = 'u-1'`)[0].since;
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-11-01T10:00:00Z') });
            const token = await tokenOf('u-1');
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-11-02T10:00:00Z') });
            assert.equal(await since(), '2026-11-01T10:00');
            await saveEmailPreferences('u-1', { alerts: false }, { database, now: new Date('2026-11-03T10:00:00Z') });
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-11-04T10:00:00Z') });
            assert.equal(await since(), '2026-11-04T10:00');
            assert.equal(await tokenOf('u-1'), token);
        });

        test('a link\'s token turns off its one email, for its owner only; an unknown token changes nothing', async () => {
            await saveEmailPreferences('u-1', { alerts: true, weeklyReview: true }, { database });
            await saveEmailPreferences('u-2', { alerts: true, weeklyReview: true }, { database });

            assert.equal(await unsubscribe(await tokenOf('u-1'), 'alerts', { database }), true);
            assert.deepEqual(await loadEmailPreferences('u-1', database), { alerts: false, weeklyReview: true, address: 'u-1@example.test' });
            assert.equal(await unsubscribe(await tokenOf('u-1'), 'weekly_review', { database }), true);
            assert.deepEqual(await loadEmailPreferences('u-1', database), { alerts: false, weeklyReview: false, address: 'u-1@example.test' });
            assert.equal(await unsubscribe('x'.repeat(43), 'alerts', { database }), false);
            assert.deepEqual(await loadEmailPreferences('u-2', database), { alerts: true, weeklyReview: true, address: 'u-2@example.test' });
        });

        test('they go with the account', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database });
            await sql`DELETE FROM auth_users WHERE id = 'u-1'`;
            assert.equal((await sql`SELECT 1 FROM email_preferences`).length, 0);
        });
    });

    describe('alert emails', () => {
        test('one email per user with the alerts raised since email went on: not read, cleared, older or from before', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            await saveEmailPreferences('u-3', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            const newer = await raise('u-1', '2026-11-02 22:35', { message: 'AAPL closed at $210.00 on Nov 2, at or above $200.00.' });
            const older = await raise('u-1', '2026-10-30 23:35', { message: 'Your accounts closed at $105,000.00 on Oct 30.' });
            const read = await raise('u-1', '2026-11-02 22:35', { readAt: '2026-11-02 23:00' });
            const cleared = await raise('u-1', '2026-11-02 22:35', { cleared: true });
            const before = await raise('u-1', '2026-10-28 22:35');
            const third = await raise('u-3', '2026-11-02 22:35');
            await raise('u-2', '2026-11-02 22:35'); // email off
            // Raised after email went on, but over three days ago: old news.
            await sql`UPDATE email_preferences SET alerts_since = '2026-10-20 00:00' WHERE user_id = 'u-3'`;
            const stale = await raise('u-3', '2026-10-27 22:35');

            const fake = outbox();
            const detail = await run(MONDAY, { send: fake.send });
            assert.deepEqual(detail.alerts, { sent: 2, failed: 0, deferred: 0 });
            assert.deepEqual(fake.sent.map((email) => email.to), ['u-1@example.test', 'u-3@example.test']);

            const [first] = fake.sent;
            assert.equal(first.subject, '2 alerts from Atlas Wealth');
            assert.ok(first.text.indexOf('AAPL closed at $210.00') < first.text.indexOf('Your accounts closed'), 'newest first');
            assert.equal(first.category, 'alerts');
            const token = await tokenOf('u-1');
            assert.equal(first.headers['List-Unsubscribe'], `<https://atlas.example.test/api/email/unsubscribe?token=${token}&list=alerts>`);
            assert.equal(first.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
            assert.ok(first.idempotencyKey.startsWith('alerts/'));

            for (const id of [newer, older, third]) assert.equal(await emailedAt(id), '2026-11-02T22:35');
            for (const id of [read, cleared, before, stale]) assert.equal(await emailedAt(id), null);

            // The next run has nothing new to send.
            const again = outbox();
            assert.deepEqual((await run(new Date(MONDAY.getTime() + 3_600_000), { send: again.send })).alerts, { sent: 0, failed: 0, deferred: 0 });
            assert.equal(again.sent.length, 0);
        });

        test('a failed email gives its alerts back and fails the run after the others have gone; a later run sends them', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            await saveEmailPreferences('u-2', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            const failing = await raise('u-1', '2026-11-02 22:35');
            const going = await raise('u-2', '2026-11-02 22:35');

            const fake = outbox(['u-1@example.test']);
            await assert.rejects(run(MONDAY, { send: fake.send }), (error: unknown) => {
                assert.ok(error instanceof EmailJobError);
                assert.equal(error.message, '1 email couldn\'t be sent and will go on a later run. First: Resend refused the email (HTTP 500).');
                assert.deepEqual(error.detail.alerts, { sent: 1, failed: 1, deferred: 0 });
                return true;
            });
            assert.deepEqual(fake.sent.map((email) => email.to), ['u-2@example.test']);
            assert.equal(await emailedAt(failing), null);
            assert.notEqual(await emailedAt(going), null);
            assert.equal((await sql`SELECT 1 FROM alert_notifications WHERE email_claimed_at IS NOT NULL`).length, 0, 'no claim is left behind');

            const retry = outbox();
            const later = new Date(MONDAY.getTime() + 86_400_000);
            assert.deepEqual((await run(later, { send: retry.send })).alerts, { sent: 1, failed: 0, deferred: 0 });
            assert.deepEqual(retry.sent.map((email) => email.to), ['u-1@example.test']);
            assert.equal(retry.sent[0].subject, 'Your AAPL alert');
        });

        test('two runs at once send each alert once', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            await raise('u-1', '2026-11-02 22:35');
            const fake = outbox();
            await Promise.all([run(MONDAY, { send: fake.send }), run(MONDAY, { send: fake.send })]);
            assert.equal(fake.sent.length, 1);
        });

        test('sends are spaced out, and once the budget is spent the rest wait for the next run', async () => {
            for (const user of ['u-1', 'u-2', 'u-3']) {
                await saveEmailPreferences(user, { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
                await raise(user, '2026-11-02 22:35');
            }
            let clock = 0;
            const pauses: number[] = [];
            const fake = outbox();
            const send = async (email: OutgoingEmail) => {
                clock += 100;
                return fake.send(email);
            };
            const detail = await run(MONDAY, {
                send,
                clock: () => clock,
                pause: async (ms) => { pauses.push(ms); clock += ms; },
                budgetMs: 600,
            });
            assert.deepEqual(pauses, [400], 'half a second between sends');
            assert.deepEqual(detail.alerts, { sent: 2, failed: 0, deferred: 1 });
            const waiting = await sql`SELECT 1 FROM alert_notifications WHERE emailed_at IS NULL`;
            assert.equal(waiting.length, 1);
        });

        test('regression: an email whose run was cut off after claiming it goes on a later run; one a live run holds isn\'t taken', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            await saveEmailPreferences('u-2', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            const abandoned = await raise('u-1', '2026-11-02 22:35');
            const inFlight = await raise('u-2', '2026-11-02 22:35');
            // The function was stopped twenty minutes ago between claiming and sending; another run claimed a minute ago.
            await sql`UPDATE alert_notifications SET email_claimed_at = '2026-11-02 22:15' WHERE id = ${abandoned}`;
            await sql`UPDATE alert_notifications SET email_claimed_at = '2026-11-02 22:34' WHERE id = ${inFlight}`;

            const fake = outbox();
            assert.deepEqual((await run(MONDAY, { send: fake.send })).alerts, { sent: 1, failed: 0, deferred: 0 });
            assert.deepEqual(fake.sent.map((email) => email.to), ['u-1@example.test']);
            assert.equal(await emailedAt(abandoned), '2026-11-02T22:35');
            assert.equal(await emailedAt(inFlight), null);
        });

        test('Friday evening\'s alerts still go on Monday, when Friday\'s run couldn\'t send them', async () => {
            await saveEmailPreferences('u-1', { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            const friday = await raise('u-1', '2026-10-30 23:20'); // Hobby can start the 22:30 run late
            const fake = outbox();
            assert.equal((await run(new Date('2026-11-02T22:31:00.000Z'), { send: fake.send })).alerts?.sent, 1);
            assert.notEqual(await emailedAt(friday), null);
        });

        test('while reviews are due alerts get half the budget, and whoever was put off goes first the next evening', async () => {
            for (const user of ['u-1', 'u-2', 'u-3']) {
                await saveEmailPreferences(user, { alerts: true }, { database, now: new Date('2026-10-29T12:00:00Z') });
            }
            await raise('u-3', '2026-10-30 22:35'); // waiting since Friday
            await raise('u-1', '2026-11-02 22:35');
            await raise('u-2', '2026-11-02 22:35');
            await sql`INSERT INTO auth_users (id, name, email) VALUES ('u-4', 'u-4', 'u-4@example.test')`;
            await saveEmailPreferences('u-4', { weeklyReview: true }, { database });

            const timed = () => {
                let clock = 0;
                const fake = outbox();
                return {
                    fake,
                    deps: {
                        send: async (email: OutgoingEmail) => { clock += 100; return fake.send(email); },
                        clock: () => clock,
                        pause: async (ms: number) => { clock += ms; },
                        budgetMs: 1_000,
                        loadJournal: async (userId: string) => (userId === 'u-4' ? WEEK_TRADES : { entries: [], leftOut: [], netWorth: 0 }),
                    },
                };
            };

            // Monday: alerts stop at half a second, so the review still goes.
            const monday = timed();
            const detail = await run(MONDAY, monday.deps);
            assert.deepEqual(detail.alerts, { sent: 2, failed: 0, deferred: 1 });
            assert.deepEqual(detail.weeklyReview, { week: 'wk:2026-10-26', sent: 1, noTrades: 0, failed: 0, deferred: 0 });
            assert.deepEqual(monday.fake.sent.map((email) => email.to), ['u-3@example.test', 'u-1@example.test', 'u-4@example.test'],
                'the alert waiting since Friday first');

            // Tuesday: new alerts for u-1, but u-2 has waited longest and goes first.
            await raise('u-1', '2026-11-03 22:35');
            const tuesday = timed();
            await run(new Date('2026-11-03T22:35:00.000Z'), { ...tuesday.deps, budgetMs: 100 });
            assert.deepEqual(tuesday.fake.sent.map((email) => email.to), ['u-2@example.test']);
        });
    });

    describe('weekly review emails', () => {
        test('after Friday\'s close, the week\'s review of closed trades, once; none for a week without trades', async () => {
            await saveEmailPreferences('u-1', { weeklyReview: true }, { database });
            await saveEmailPreferences('u-2', { weeklyReview: true }, { database });
            await saveEmailPreferences('u-3', { alerts: true }, { database });
            const journals: Record<string, TradeJournal> = { 'u-1': WEEK_TRADES, 'u-2': { entries: [], leftOut: [], netWorth: 0 } };
            const loaded: string[] = [];
            const loadJournal = async (userId: string) => { loaded.push(userId); return journals[userId]; };

            const fake = outbox();
            const detail = await run(FRIDAY, { send: fake.send, loadJournal });
            assert.deepEqual(detail.weeklyReview, { week: 'wk:2026-10-26', sent: 1, noTrades: 1, failed: 0, deferred: 0 });
            assert.deepEqual(loaded, ['u-1', 'u-2']);
            assert.equal(fake.sent.length, 1);
            const [email] = fake.sent;
            assert.equal(email.to, 'u-1@example.test');
            assert.equal(email.subject, 'Your weekly review: Oct 26–30');
            assert.equal(email.category, 'weekly_review');
            assert.ok(email.text.includes('Realized P&L: +$300 (+0.30% of net worth · 2 closed trades)'));
            assert.ok(email.text.includes('Not counted: trades in NVDA'));
            assert.equal(email.headers['List-Unsubscribe'], `<https://atlas.example.test/api/email/unsubscribe?token=${await tokenOf('u-1')}&list=weekly_review>`);

            // Monday's run: the week is handled for both.
            const monday = outbox();
            assert.deepEqual((await run(MONDAY, { send: monday.send, loadJournal })).weeklyReview, { week: 'wk:2026-10-26', sent: 0, noTrades: 0, failed: 0, deferred: 0 });
            assert.equal(monday.sent.length, 0);
        });

        test('a failed send is tried again by a later run that week, and not after Tuesday\'s close', async () => {
            await saveEmailPreferences('u-1', { weeklyReview: true }, { database });
            const loadJournal = async () => WEEK_TRADES;

            await assert.rejects(run(FRIDAY, { send: outbox(['u-1@example.test']).send, loadJournal }), EmailJobError);
            const monday = outbox();
            assert.equal((await run(MONDAY, { send: monday.send, loadJournal })).weeklyReview?.week, 'wk:2026-10-26');
            assert.equal(monday.sent.length, 1);

            await saveEmailPreferences('u-2', { weeklyReview: true }, { database });
            const tuesdayEvening = outbox();
            assert.deepEqual((await run(new Date('2026-11-03T22:35:00.000Z'), { send: tuesdayEvening.send, loadJournal })).weeklyReview, { week: null });
            assert.equal(tuesdayEvening.sent.length, 0, 'too late for last week, too early for this one');
        });

        test('a journal that can\'t be read fails that user\'s review, and leaves it for a later run', async () => {
            await saveEmailPreferences('u-1', { weeklyReview: true }, { database });
            await assert.rejects(run(FRIDAY, { send: outbox().send, loadJournal: async () => { throw new Error('database timeout'); } }), /First: database timeout/);
            const [row] = await sql<{ weekly_review_week: string | null; weekly_review_claimed_at: Date | null }[]>`SELECT weekly_review_week, weekly_review_claimed_at FROM email_preferences WHERE user_id = 'u-1'`;
            assert.equal(row.weekly_review_week, null);
            assert.equal(row.weekly_review_claimed_at, null);
        });

        test('regression: a review whose run was cut off after claiming it goes on a later run; one a live run holds isn\'t taken', async () => {
            await saveEmailPreferences('u-1', { weeklyReview: true }, { database });
            await saveEmailPreferences('u-2', { weeklyReview: true }, { database });
            await sql`UPDATE email_preferences SET weekly_review_claimed_at = '2026-10-30 22:15' WHERE user_id = 'u-1'`;
            await sql`UPDATE email_preferences SET weekly_review_claimed_at = '2026-10-30 22:34' WHERE user_id = 'u-2'`;

            const fake = outbox();
            assert.deepEqual((await run(FRIDAY, { send: fake.send, loadJournal: async () => WEEK_TRADES })).weeklyReview,
                { week: 'wk:2026-10-26', sent: 1, noTrades: 0, failed: 0, deferred: 0 });
            assert.deepEqual(fake.sent.map((email) => email.to), ['u-1@example.test']);
            const rows = await sql<{ user_id: string; weekly_review_week: string | null }[]>`SELECT user_id, weekly_review_week FROM email_preferences ORDER BY user_id`;
            assert.deepEqual(rows.map((r) => [r.user_id, r.weekly_review_week]), [['u-1', 'wk:2026-10-26'], ['u-2', null]]);
        });

        test('before Friday\'s close nothing is sent for the week', async () => {
            await saveEmailPreferences('u-1', { weeklyReview: true }, { database });
            const thursday = outbox();
            assert.deepEqual((await run(new Date('2026-10-29T22:35:00.000Z'), { send: thursday.send, loadJournal: async () => WEEK_TRADES })).weeklyReview, { week: null });
            assert.equal(thursday.sent.length, 0);
        });
    });
});
