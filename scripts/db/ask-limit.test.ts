import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import {
    ASK_DAILY_LIMIT,
    AskDailyLimitError,
    clearAskHistory,
    loadAskHistory,
    releaseAskQuestion,
    reserveAskQuestion,
    saveAskAnswer,
} from '../../src/lib/ask/server/history';
import type { AskMessage } from '../../src/lib/ask/types';

// Launch item i59: a question takes its place in Ask's daily limit before
// it's answered, so questions sent at once (each answered by Claude, at a
// cost) can't go past it. Against a scratch database with every migration
// applied. Needs a local Postgres it may create databases in; CI's e2e job
// sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const NOW = new Date('2026-11-04T16:00:00.000Z');

describe('Ask\'s daily limit', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `ask_limit_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<Parameters<typeof reserveAskQuestion>[3]>;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        // Connections enough for questions to arrive at once.
        sql = postgres(scratch.toString(), { max: 10, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as never;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    async function seedUser(user: string, questionsAsked: number): Promise<void> {
        await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        for (let i = 0; i < questionsAsked; i++) {
            await sql`INSERT INTO ask_messages (user_id, id, role, content, created_at)
                VALUES (${user}, ${`earlier-${i}`}, 'user', 'Earlier?', ${new Date(NOW.getTime() - (i + 1) * 60_000).toISOString()}::timestamp)`;
        }
    }

    const question = (id: string, content = 'Am I overexposed to AI?'): AskMessage => ({ id, role: 'user', content, ts: NOW.getTime() });
    const answer = (id: string): AskMessage => ({ id, role: 'assistant', content: 'Tech leads.', citations: [], toolRuns: [], ts: NOW.getTime() + 1 });

    test('regression: of questions sent at once with one place left, only one is kept to be answered', async () => {
        await seedUser('user-at-once', ASK_DAILY_LIMIT - 1);
        const results = await Promise.allSettled(
            Array.from({ length: 8 }, (_, i) => reserveAskQuestion('user-at-once', question(`q-${i}`), NOW, database)),
        );
        const kept = results.filter((result) => result.status === 'fulfilled');
        assert.equal(kept.length, 1);
        assert.equal((kept[0] as PromiseFulfilledResult<number>).value, ASK_DAILY_LIMIT);
        for (const result of results.filter((r) => r.status === 'rejected')) {
            assert.ok((result as PromiseRejectedResult).reason instanceof AskDailyLimitError);
        }
        assert.equal((await loadAskHistory('user-at-once', NOW, database)).questionsToday, ASK_DAILY_LIMIT);
    });

    test('a question kept before its answer, then the answer after it', async () => {
        await seedUser('user-turn', 0);
        assert.equal(await reserveAskQuestion('user-turn', question('q-1'), NOW, database), 1);
        await saveAskAnswer('user-turn', 'q-1', answer('a-1'), NOW, database);
        const history = await loadAskHistory('user-turn', NOW, database);
        assert.deepEqual(history.messages.map((message) => [message.id, message.role]), [['q-1', 'user'], ['a-1', 'assistant']]);
        assert.equal(history.questionsToday, 1);
    });

    test('a question that couldn\'t be answered gives its place back', async () => {
        await seedUser('user-failed', ASK_DAILY_LIMIT - 1);
        await reserveAskQuestion('user-failed', question('q-1'), NOW, database);
        await assert.rejects(reserveAskQuestion('user-failed', question('q-2'), NOW, database), AskDailyLimitError);
        await releaseAskQuestion('user-failed', 'q-1', database);
        assert.equal((await loadAskHistory('user-failed', NOW, database)).questionsToday, ASK_DAILY_LIMIT - 1);
        assert.equal(await reserveAskQuestion('user-failed', question('q-3'), NOW, database), ASK_DAILY_LIMIT);
    });

    test('an answer that lands after the conversation was cleared isn\'t brought back, and the question still counts', async () => {
        await seedUser('user-cleared', 0);
        await reserveAskQuestion('user-cleared', question('q-1'), NOW, database);
        await clearAskHistory('user-cleared', NOW, database);
        await saveAskAnswer('user-cleared', 'q-1', answer('a-1'), NOW, database);
        const history = await loadAskHistory('user-cleared', NOW, database);
        assert.deepEqual(history.messages, []);
        assert.equal(history.questionsToday, 1);
        assert.equal((await sql`SELECT 1 FROM ask_messages WHERE user_id = 'user-cleared' AND id = 'a-1'`).length, 0);
    });

    test('giving a question back touches only that user\'s question', async () => {
        await seedUser('user-b', 0);
        await reserveAskQuestion('user-b', question('shared-id'), NOW, database);
        await releaseAskQuestion('user-other', 'shared-id', database);
        assert.equal((await loadAskHistory('user-b', NOW, database)).questionsToday, 1);
    });
});
