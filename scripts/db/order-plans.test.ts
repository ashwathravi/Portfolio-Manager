import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import {
    changeOrderPlanStatus,
    createOrderPlan,
    loadUserOrderPlans,
    OrderPlanLimitError,
    OrderStatusConflictError,
} from '../../src/lib/execution/orders';
import { AccountNotFoundError } from '../../src/lib/portfolio/transactionsWrite';
import { ORDER_PLAN_LIMITS, orderPlanCreateSchema, type OrderPlanCreate } from '../../src/lib/validators/order-plan';

// Launch item i53: order plans saved from Trade, against a scratch database
// with every migration applied. Needs a local Postgres it may create
// databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

describe('order plans', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `order_plans_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof createOrderPlan>[2] & object;

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

    async function seedUser(user: string): Promise<string> {
        await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name, cash_balance) VALUES (${user}, 'Brokerage', 1000) RETURNING id`;
        return p.id;
    }

    const plan = (portfolioId: string, overrides: Partial<OrderPlanCreate> = {}): OrderPlanCreate => orderPlanCreateSchema.parse({
        portfolioId,
        instrumentType: 'equity',
        ticker: 'IBM',
        side: 'buy',
        type: 'limit',
        quantity: 2.5,
        limitPrice: 204.5,
        timeInForce: 'gtc',
        referencePrice: 205,
        referencePriceDate: '2026-10-26',
        needsApproval: false,
        rationale: {
            thesisId: 't-1', setupType: 'breakout', conviction: 7.5, mood: 'focused',
            rationale: 'Base breakout.', capturedAt: '2026-10-27T15:00:00.000Z', timeToDecisionMs: 4_000,
        },
        policy: { decision: 'allowed', summary: 'Inside policy', exceptions: [] },
        ...overrides,
    });

    test('a plan is saved for the user\'s own account as the ticket sent it, and reads back the same', async () => {
        const account = await seedUser('u-save');
        const saved = await createOrderPlan('u-save', plan(account), database);
        assert.equal(saved.status, 'ready');
        assert.deepEqual(
            [saved.portfolioId, saved.ticker, saved.quantity, saved.limitPrice, saved.stopPrice, saved.referencePrice, saved.referencePriceDate, saved.timeInForce],
            [account, 'IBM', 2.5, 204.5, undefined, 205, '2026-10-26', 'gtc'],
        );
        assert.equal(saved.rationale?.rationale, 'Base breakout.');
        assert.deepEqual(await loadUserOrderPlans('u-save', database), [saved]);

        const big = await createOrderPlan('u-save', plan(account, { needsApproval: true }), database);
        assert.equal(big.status, 'pending_approval');
    });

    test('another user\'s account, or one that doesn\'t exist, is refused and nothing is saved', async () => {
        const theirs = await seedUser('u-owner');
        await seedUser('u-intruder');
        await assert.rejects(createOrderPlan('u-intruder', plan(theirs), database), AccountNotFoundError);
        await assert.rejects(createOrderPlan('u-intruder', plan('00000000-0000-4000-8000-0000000000ff'), database), AccountNotFoundError);
        assert.deepEqual(await loadUserOrderPlans('u-intruder', database), []);
        assert.deepEqual(await loadUserOrderPlans('u-owner', database), []);
    });

    test('a plan moves from approval to ready to placed, or is cancelled, and stays cancelled', async () => {
        const account = await seedUser('u-status');
        const pending = await createOrderPlan('u-status', plan(account, { needsApproval: true }), database);
        const later = new Date('2026-10-27T16:00:00.000Z');

        await assert.rejects(changeOrderPlanStatus('u-status', pending.id, 'placed', database), OrderStatusConflictError);
        const ready = await changeOrderPlanStatus('u-status', pending.id, 'ready', database, later);
        assert.equal(ready?.status, 'ready');
        assert.equal(ready?.updatedAt, later.toISOString());
        // Asking again (a retried click) answers it as it is.
        assert.equal((await changeOrderPlanStatus('u-status', pending.id, 'ready', database))?.status, 'ready');
        assert.equal((await changeOrderPlanStatus('u-status', pending.id, 'placed', database))?.status, 'placed');
        await assert.rejects(
            changeOrderPlanStatus('u-status', pending.id, 'ready', database),
            (error: unknown) => error instanceof OrderStatusConflictError && error.order.status === 'placed',
        );
        // Cancelled at the broker before it filled.
        assert.equal((await changeOrderPlanStatus('u-status', pending.id, 'cancelled', database))?.status, 'cancelled');

        const open = await createOrderPlan('u-status', plan(account), database);
        assert.equal((await changeOrderPlanStatus('u-status', open.id, 'cancelled', database))?.status, 'cancelled');
        await assert.rejects(changeOrderPlanStatus('u-status', open.id, 'ready', database), OrderStatusConflictError);
    });

    test('another user\'s plan can\'t be changed, as if it didn\'t exist', async () => {
        const account = await seedUser('u-mine');
        await seedUser('u-theirs');
        const mine = await createOrderPlan('u-mine', plan(account), database);
        assert.equal(await changeOrderPlanStatus('u-theirs', mine.id, 'cancelled', database), null);
        assert.equal((await loadUserOrderPlans('u-mine', database))[0].status, 'ready');
    });

    test('open plans are listed however old, placed and cancelled ones newest first', async () => {
        const account = await seedUser('u-list');
        const old = await createOrderPlan('u-list', plan(account, { ticker: 'OLD' }), database);
        await sql`UPDATE order_plans SET created_at = '2020-01-01' WHERE id = ${old.id}`;
        const done = await createOrderPlan('u-list', plan(account, { ticker: 'DONE' }), database);
        await changeOrderPlanStatus('u-list', done.id, 'cancelled', database);
        const fresh = await createOrderPlan('u-list', plan(account, { ticker: 'NEW' }), database);
        assert.deepEqual((await loadUserOrderPlans('u-list', database)).map((o) => o.ticker), [fresh.ticker, done.ticker, old.ticker]);
    });

    test('a plan goes with its account, and with the user', async () => {
        const account = await seedUser('u-cascade');
        await createOrderPlan('u-cascade', plan(account), database);
        await sql`DELETE FROM portfolios WHERE id = ${account}`;
        assert.deepEqual(await loadUserOrderPlans('u-cascade', database), []);

        const second = (await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('u-cascade', 'IRA') RETURNING id`)[0].id;
        await createOrderPlan('u-cascade', plan(second), database);
        await sql`DELETE FROM portfolios WHERE user_id = 'u-cascade'`;
        await sql`DELETE FROM auth_users WHERE id = 'u-cascade'`;
        assert.equal((await sql`SELECT 1 FROM order_plans WHERE user_id = 'u-cascade'`).length, 0);
    });

    test('a user can keep only so many plans', async () => {
        const account = await seedUser('u-limit');
        await sql`
            INSERT INTO order_plans (user_id, portfolio_id, instrument_type, symbol, side, order_type, quantity, time_in_force, status)
            SELECT 'u-limit', ${account}, 'equity', 'IBM', 'buy', 'market', 1, 'day', 'cancelled'
            FROM generate_series(1, ${ORDER_PLAN_LIMITS.perUser - 1})`;
        await createOrderPlan('u-limit', plan(account), database);
        await assert.rejects(createOrderPlan('u-limit', plan(account), database), OrderPlanLimitError);
    });

    test('the table refuses what the ticket never sends', async () => {
        const account = await seedUser('u-checks');
        const insert = (status: string, quantity: number) => sql`
            INSERT INTO order_plans (user_id, portfolio_id, instrument_type, symbol, side, order_type, quantity, time_in_force, status)
            VALUES ('u-checks', ${account}, 'equity', 'IBM', 'buy', 'market', ${quantity}, 'day', ${status})`;
        await assert.rejects(insert('filled', 1), /order_plans_status_check/);
        await assert.rejects(insert('ready', 0), /order_plans_quantity_check/);
    });

    test('the table refuses a plan filed under another user\'s account, whatever the code checks (i69)', async () => {
        const mine = await seedUser('u-fk-plan-owner');
        await seedUser('u-fk-plan-intruder');
        await assert.rejects(sql`
            INSERT INTO order_plans (user_id, portfolio_id, instrument_type, symbol, side, order_type, quantity, time_in_force, status)
            VALUES ('u-fk-plan-intruder', ${mine}, 'equity', 'IBM', 'buy', 'market', 1, 'day', 'ready')`, /order_plans_portfolio_owner_fk/);

        const [saved] = await sql<{ id: string }[]>`
            INSERT INTO order_plans (user_id, portfolio_id, instrument_type, symbol, side, order_type, quantity, time_in_force, status)
            VALUES ('u-fk-plan-owner', ${mine}, 'equity', 'IBM', 'buy', 'market', 1, 'day', 'ready') RETURNING id`;
        await assert.rejects(sql`UPDATE order_plans SET user_id = 'u-fk-plan-intruder' WHERE id = ${saved.id}`, /order_plans_portfolio_owner_fk/);
    });
});
