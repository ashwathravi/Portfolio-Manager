import { randomUUID } from 'node:crypto';

import type { BrowserContext } from '@playwright/test';
import postgres from 'postgres';

import { E2E_STORAGE_SCOPE } from './storage';

// Settings live on the server per user (launch item i37), so a test that
// changes them would change them for every other test signed in as fixture
// user A. Such tests sign in as a fresh user instead: a copy of user A with
// the same portfolios, holdings and transactions, and settings of its own.

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const FIXTURE_USER_ID = E2E_STORAGE_SCOPE;

let client: ReturnType<typeof postgres> | null = null;

function database() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Fresh E2E users need DATABASE_URL (the app login the web server uses).');
    client ??= postgres(url, { max: 1, idle_timeout: 1, onnotice: () => {} });
    return client;
}

/**
 * Signs `context` in as a new copy of fixture user A and returns its ID, the
 * storage scope its browser data lives under. Without database sessions
 * settings only live in each test's own browser storage, so nothing is
 * shared and the fixture user stays.
 */
export async function signInAsFreshUser(context: BrowserContext): Promise<string> {
    if (!databaseAuthEnabled) return FIXTURE_USER_ID;

    const id = randomUUID();
    const sessionToken = `e2e-session-${id}`;
    const sql = database();
    await sql.begin(async (transaction) => {
        // postgres.js types a transaction without its tagged-template call.
        const tx = transaction as unknown as typeof sql;
        await tx`
            INSERT INTO auth_users (id, name, email, email_verified)
            VALUES (${id}, 'E2E User A (copy)', ${`e2e-${id}@example.test`}, now())`;
        await tx`
            INSERT INTO auth_sessions (session_token, user_id, expires)
            VALUES (${sessionToken}, ${id}, '2099-01-01T00:00:00Z')`;
        // New portfolio IDs are derived from the old ones, so holdings and
        // transactions can follow them without a lookup.
        await tx`
            INSERT INTO portfolios (id, user_id, name, description, total_value, cash_balance)
            SELECT md5(${id} || p.id::text)::uuid, ${id}, p.name, p.description, p.total_value, p.cash_balance
            FROM portfolios p WHERE p.user_id = ${FIXTURE_USER_ID}`;
        await tx`
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost, current_price, market_value, allocation)
            SELECT md5(${id} || h.portfolio_id::text)::uuid, h.symbol, h.name, h.quantity, h.avg_cost,
                   h.current_price, h.market_value, h.allocation
            FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id
            WHERE p.user_id = ${FIXTURE_USER_ID}`;
        await tx`
            INSERT INTO transactions (portfolio_id, symbol, type, quantity, price, timestamp, amount, notes)
            SELECT md5(${id} || t.portfolio_id::text)::uuid, t.symbol, t.type, t.quantity, t.price,
                   t.timestamp, t.amount, t.notes
            FROM transactions t JOIN portfolios p ON p.id = t.portfolio_id
            WHERE p.user_id = ${FIXTURE_USER_ID}`;
    });

    await setSessionCookie(context, sessionToken);
    return id;
}

/**
 * Signs `context` in as a brand-new user: no accounts, nothing else. With
 * `firstSignIn`, also the settings a real first sign-in stores (example data
 * off: NEW_USER_SETTINGS in src/lib/settings/server.ts; an older version
 * stamp is migrated forward like any stored document). Returns the user's
 * ID; null without database sessions, where there is no such user.
 */
export async function signInAsNewUser(context: BrowserContext, { firstSignIn = false } = {}): Promise<string | null> {
    if (!databaseAuthEnabled) return null;

    const id = randomUUID();
    const sessionToken = `e2e-session-${id}`;
    const sql = database();
    await sql.begin(async (transaction) => {
        const tx = transaction as unknown as typeof sql;
        await tx`
            INSERT INTO auth_users (id, name, email, email_verified)
            VALUES (${id}, 'E2E New User', ${`e2e-${id}@example.test`}, now())`;
        await tx`
            INSERT INTO auth_sessions (session_token, user_id, expires)
            VALUES (${sessionToken}, ${id}, '2099-01-01T00:00:00Z')`;
        if (firstSignIn) {
            await tx`
                INSERT INTO user_settings (user_id, version, settings)
                VALUES (${id}, 15, ${sql.json({ demo: { showSampleData: false } })})`;
        }
    });

    await setSessionCookie(context, sessionToken);
    return id;
}

async function setSessionCookie(context: BrowserContext, sessionToken: string) {
    // Leave open pages first: every signed-in response sets the session
    // cookie again, so a request still on its way would bring user A back.
    for (const open of context.pages()) await open.goto('about:blank');
    await context.clearCookies();
    await context.addCookies([{
        name: 'authjs.session-token',
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
    }]);
}

/**
 * What the database still holds for a user (launch item i65): their user
 * row, sessions, accounts and settings. All zero once the account is deleted.
 */
export async function accountRowsLeft(userId: string): Promise<{ users: number; sessions: number; portfolios: number; settings: number }> {
    const sql = database();
    const [counts] = await sql<{ users: number; sessions: number; portfolios: number; settings: number }[]>`
        SELECT
            (SELECT count(*) FROM auth_users WHERE id = ${userId})::int AS users,
            (SELECT count(*) FROM auth_sessions WHERE user_id = ${userId})::int AS sessions,
            (SELECT count(*) FROM portfolios WHERE user_id = ${userId})::int AS portfolios,
            (SELECT count(*) FROM user_settings WHERE user_id = ${userId})::int AS settings`;
    return { ...counts };
}

