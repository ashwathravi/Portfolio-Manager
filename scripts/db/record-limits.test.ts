import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { RECORD_LIMITS, RecordLimitError } from '../../src/lib/limits/records';
import { addTransaction, deleteTransaction, importTransactions } from '../../src/lib/portfolio/transactionsWrite';
import { importJournal, saveJournalEntry } from '../../src/lib/research/server/journal';
import { importTheses, saveThesis } from '../../src/lib/research/server/theses';
import { importWatchlist, saveWatchItem } from '../../src/lib/research/server/watchlist';
import type { JournalEntryInput } from '../../src/lib/validators/journal';
import type { ThesisInput } from '../../src/lib/validators/thesis';
import { transactionRowSchema } from '../../src/lib/validators/transaction';
import type { WatchItemInput } from '../../src/lib/validators/watchlist';

// Launch item i77: how many watchlist items, journal entries, theses and
// transactions one user keeps, checked by the real writes against a scratch
// database with every migration applied. Needs a local Postgres it may
// create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

describe('per-user record limits (launch item i77)', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `record_limits_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof saveWatchItem>[3] extends { database?: infer D } | undefined ? NonNullable<D> : never;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        // Two connections, so two saves can wait on each other's lock.
        sql = postgres(scratch.toString(), { max: 2, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as typeof database;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    beforeEach(async () => {
        await sql`TRUNCATE auth_users CASCADE`;
        await sql`INSERT INTO auth_users (id, name, email) VALUES ('u-1', 'One', 'u-1@example.test'), ('u-2', 'Two', 'u-2@example.test')`;
    });

    let seq = 0;
    const order = () => ({ session: 'page-1', seq: ++seq });
    const live = async (table: 'watchlist_items' | 'journal_entries' | 'theses', user = 'u-1') =>
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(table)} WHERE user_id = ${user} AND NOT dismissed`)[0].n;

    describe('watchlist', () => {
        const item = (id: string, ticker: string, fields: Partial<WatchItemInput> = {}): WatchItemInput => ({
            id, ticker, companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-11-14', dismissed: false, ...fields,
        });
        /** `count` live items w-1…, and `removed` dismissed ones. */
        async function fill(count: number, removed = 0, user = 'u-1') {
            await sql`INSERT INTO watchlist_items (user_id, id, ticker, added_at)
                      SELECT ${user}, 'w-' || n, 'T' || n, '2026-11-01' FROM generate_series(1, ${count}) AS n`;
            await sql`INSERT INTO watchlist_items (user_id, id, ticker, added_at, dismissed)
                      SELECT ${user}, 'gone-' || n, 'G' || n, '2026-11-01', true FROM generate_series(1, ${removed}) AS n`;
        }
        const save = (input: WatchItemInput, user = 'u-1') => saveWatchItem(user, input, order(), { database });

        test('at the limit a new ticker is refused; an edit or a removal isn\'t, and a removal makes room', async () => {
            assert.equal(RECORD_LIMITS.watchlist, 500);
            await fill(500, 20);

            await assert.rejects(save(item('w-new', 'NEW')), RecordLimitError);
            assert.equal(await live('watchlist_items'), 500);
            assert.equal((await sql`SELECT 1 FROM watchlist_items WHERE id = 'w-new'`).length, 0, 'rolled back');

            await save(item('w-1', 'T1', { reason: 'Edited at the limit' }));
            assert.equal((await sql`SELECT reason FROM watchlist_items WHERE id = 'w-1'`)[0].reason, 'Edited at the limit');
            await save(item('w-2', 'T2', { dismissed: true }));
            assert.equal(await live('watchlist_items'), 499);
            await save(item('w-new', 'NEW'));
            assert.equal(await live('watchlist_items'), 500);

            // Another user's list is their own.
            await save(item('w-new', 'NEW'), 'u-2');
            assert.equal(await live('watchlist_items', 'u-2'), 1);
        });

        test('an import that would pass the limit adds nothing; one that adds nothing new goes through', async () => {
            await fill(499);
            await assert.rejects(
                importWatchlist('u-1', { items: [item('i-1', 'NEW1'), item('i-2', 'NEW2')] }, { database }),
                RecordLimitError,
            );
            assert.equal(await live('watchlist_items'), 499);
            assert.equal((await sql`SELECT 1 FROM watchlist_items WHERE id IN ('i-1', 'i-2')`).length, 0);

            // Items the account has, and a removed example's placeholder, add nothing live.
            await importWatchlist('u-1', { items: [item('w-1', 'T1'), item('example-1', 'EX', { dismissed: true })] }, { database });
            await importWatchlist('u-1', { items: [item('i-1', 'NEW1')] }, { database });
            assert.equal(await live('watchlist_items'), 500);
        });

        test('a user already past the limit can still edit and remove, but not add', async () => {
            await fill(503);
            await save(item('w-1', 'T1', { notes: 'still editable' }));
            await save(item('w-2', 'T2', { dismissed: true }));
            assert.equal(await live('watchlist_items'), 502);
            await assert.rejects(save(item('w-new', 'NEW')), RecordLimitError);
        });

        test('two saves for the last place at once: one goes, the other is refused', async () => {
            await fill(499);
            const results = await Promise.allSettled([save(item('a', 'AAA')), save(item('b', 'BBB'))]);
            assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
            const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
            assert.ok(refused.reason instanceof RecordLimitError);
            assert.equal(await live('watchlist_items'), 500);
        });
    });

    describe('journal', () => {
        const entry = (id: string, fields: Partial<JournalEntryInput> = {}): JournalEntryInput => ({
            id, date: '2026-11-14', type: 'entry', ticker: 'NVDA', decision: 'Opened', rationale: 'Demand', outcome: 'pending', thesisId: null, dismissed: false, ...fields,
        });

        test('at 2,000 entries a new one is refused, alone or imported; an edit or a deletion isn\'t', async () => {
            assert.equal(RECORD_LIMITS.journal, 2_000);
            await sql`INSERT INTO journal_entries (user_id, id, date, type, ticker, decision, rationale, outcome)
                      SELECT 'u-1', 'j-' || n, '2026-11-01', 'entry', 'NVDA', 'Opened', 'Demand', 'pending' FROM generate_series(1, 2000) AS n`;

            await assert.rejects(saveJournalEntry('u-1', entry('j-new'), order(), { database }), RecordLimitError);
            await assert.rejects(importJournal('u-1', { items: [entry('j-import')] }, { database }), RecordLimitError);
            assert.equal(await live('journal_entries'), 2_000);

            await saveJournalEntry('u-1', entry('j-1', { rationale: 'Edited' }), order(), { database });
            await saveJournalEntry('u-1', entry('j-2', { dismissed: true }), order(), { database });
            await saveJournalEntry('u-1', entry('j-new'), order(), { database });
            assert.equal(await live('journal_entries'), 2_000);
        });
    });

    describe('theses', () => {
        const thesis = (id: string, fields: Partial<ThesisInput> = {}): ThesisInput => ({
            id, ticker: 'NVDA', companyName: '', title: 'AI', description: '', type: 'bull', status: 'active', conviction: 'HIGH',
            targetPrice: 950, currentPrice: null, timeHorizon: '', dateCreated: '2026-11-01', dateUpdated: '2026-11-14', tags: [],
            hypothesis: '', bullCase: [], bearCase: [], catalysts: [{ id: 'c-1', title: 'Earnings', date: 'Q1', impact: 'high' }],
            linkedEvidence: [{ id: 'e-1', title: 'Filing', type: 'report', date: '2026-11-01', url: 'https://example.test/10k' }],
            healthScore: 50, dismissed: false, ...fields,
        } as ThesisInput);

        test('at 200 theses a new one is refused with its catalysts and evidence; an edit or a deletion isn\'t', async () => {
            assert.equal(RECORD_LIMITS.theses, 200);
            await sql`INSERT INTO theses (user_id, id, ticker, title, type, status, conviction, target_price, date_created, date_updated)
                      SELECT 'u-1', 't-' || n, 'NVDA', 'AI', 'bull', 'active', 'HIGH', 950, '2026-11-01', '2026-11-14' FROM generate_series(1, 200) AS n`;

            await assert.rejects(saveThesis('u-1', thesis('t-new'), order(), { database }), RecordLimitError);
            await assert.rejects(importTheses('u-1', { items: [thesis('t-import')] }, { database }), RecordLimitError);
            assert.equal(await live('theses'), 200);
            assert.equal((await sql`SELECT 1 FROM thesis_catalysts WHERE thesis_id IN ('t-new', 't-import')`).length, 0);
            assert.equal((await sql`SELECT 1 FROM thesis_evidence WHERE thesis_id IN ('t-new', 't-import')`).length, 0);

            assert.equal(await saveThesis('u-1', thesis('t-1', { title: 'Edited' }), order(), { database }), true);
            assert.equal((await sql`SELECT 1 FROM thesis_catalysts WHERE thesis_id = 't-1'`).length, 1);
            await saveThesis('u-1', thesis('t-2', { dismissed: true }), order(), { database });
            await saveThesis('u-1', thesis('t-new'), order(), { database });
            assert.equal(await live('theses'), 200);
        });
    });

    describe('transactions', () => {
        const deposit = (fields: Record<string, unknown> = {}) => transactionRowSchema.parse({ type: 'DEPOSIT', date: '2026-11-14', amount: 100, ...fields });

        test('at 50,000 across the user\'s accounts one entered by hand or imported is refused; deleting one makes room', async () => {
            assert.equal(RECORD_LIMITS.transactions, 50_000);
            const [a, b] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('u-1', 'Brokerage'), ('u-1', 'IRA') RETURNING id`;
            const [other] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('u-2', 'Brokerage') RETURNING id`;
            await sql`INSERT INTO transactions (portfolio_id, type, amount, timestamp, external_id)
                      SELECT ${a.id}, 'DEPOSIT', 1, '2026-11-01', 'csv:dup-' || n FROM generate_series(1, 30000) AS n`;
            await sql`INSERT INTO transactions (portfolio_id, type, amount, timestamp)
                      SELECT ${b.id}, 'DEPOSIT', 1, '2026-11-01' FROM generate_series(1, 20000) AS n`;
            const count = async () => (await sql<{ n: number }[]>`
                SELECT count(*)::int AS n FROM transactions WHERE portfolio_id IN (SELECT id FROM portfolios WHERE user_id = 'u-1')`)[0].n;

            await assert.rejects(addTransaction('u-1', b.id, deposit(), database), RecordLimitError);
            await assert.rejects(importTransactions('u-1', b.id, [deposit({ amount: 5 }), deposit({ amount: 6 })], database), RecordLimitError);
            assert.equal(await count(), 50_000);

            // A file imported again adds nothing, so it goes through.
            assert.deepEqual(await importTransactions('u-1', a.id, [deposit({ externalId: 'dup-1' })], database), { inserted: 0, duplicates: 1 });

            // Another user's accounts are theirs.
            await addTransaction('u-2', other.id, deposit(), database);

            const [oldest] = await sql<{ id: string }[]>`SELECT id FROM transactions WHERE portfolio_id = ${b.id} LIMIT 1`;
            assert.equal(await deleteTransaction('u-1', oldest.id, database), true);
            await addTransaction('u-1', b.id, deposit(), database);
            assert.equal(await count(), 50_000);
        });
    });
});
