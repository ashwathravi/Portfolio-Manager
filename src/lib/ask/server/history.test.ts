import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
    ASK_HISTORY_LIMIT,
    buildAskHistoryQuery,
    buildClearAskHistoryQuery,
    buildInsertMessagesQuery,
    buildLockAskQuery,
    buildPruneAllAskHistoryQuery,
    buildPruneAskHistoryQuery,
    buildQuestionsSinceQuery,
    pruneAskHistory,
} from './history';

describe('Ask history queries', () => {
    test('the conversation: the user\'s messages not cleared, newest first, at most the limit', () => {
        const { sql, params } = buildAskHistoryQuery('user-a').toSQL();
        assert.match(sql, /where \("ask_messages"."user_id" = \$1 and "ask_messages"."cleared" = \$2\)/);
        assert.match(sql, /order by "ask_messages"."created_at" desc, "ask_messages"."id" desc limit \$3$/);
        assert.deepEqual(params, ['user-a', false, ASK_HISTORY_LIMIT]);
    });

    test('the daily count: the user\'s questions since, cleared ones included', () => {
        const since = new Date('2026-10-25T16:00:00.000Z');
        const { sql, params } = buildQuestionsSinceQuery('user-a', since).toSQL();
        assert.match(sql, /select count\(\*\) from "ask_messages" where \("ask_messages"."user_id" = \$1 and "ask_messages"."role" = \$2 and "ask_messages"."created_at" >= \$3\)/);
        assert.deepEqual(params.slice(0, 2), ['user-a', 'user']);
        assert.doesNotMatch(sql, /cleared/);
    });

    test('clearing marks the user\'s rows; it doesn\'t delete them', () => {
        const { sql, params } = buildClearAskHistoryQuery('user-a').toSQL();
        assert.match(sql, /^update "ask_messages" set "cleared" = \$1 where \("ask_messages"."user_id" = \$2 and "ask_messages"."cleared" = \$3\)$/);
        assert.deepEqual(params, [true, 'user-a', false]);
    });

    test('pruning removes only the user\'s old rows that are cleared or past the conversation', () => {
        const { sql, params } = buildPruneAskHistoryQuery('user-a', new Date('2026-10-25T16:00:00.000Z')).toSQL();
        assert.match(sql, /^delete from "ask_messages" where \("ask_messages"."user_id" = \$1 and "ask_messages"."created_at" < \$2 and \("ask_messages"."cleared" = \$3 or "ask_messages"."id" not in \(select "id" from "ask_messages" where \("ask_messages"."user_id" = \$4 and "ask_messages"."cleared" = \$5\) order by "ask_messages"."created_at" desc, "ask_messages"."id" desc limit \$6\)\)\)$/);
        assert.deepEqual(params, ['user-a', '2026-10-25T16:00:00.000Z', true, 'user-a', false, ASK_HISTORY_LIMIT]);
    });

    test('messages are stored for the user, with their time', () => {
        const { sql, params } = buildInsertMessagesQuery('user-a', [
            { id: 'q1', role: 'user', content: 'Am I overexposed to AI?', ts: Date.UTC(2026, 9, 26, 16) },
            { id: 'a1', role: 'assistant', content: 'Tech leads.', citations: [], toolRuns: [], ts: Date.UTC(2026, 9, 26, 16) + 1 },
        ]).toSQL();
        assert.match(sql, /^insert into "ask_messages" \("user_id", "id", "role", "content", "citations", "tool_runs", "cleared", "created_at"\)/);
        assert.equal(params[0], 'user-a');
        assert.equal(params[1], 'q1');
    });

    test('the daily job: every user\'s old rows that are cleared or past their conversation', async () => {
        let executed: SQL | null = null;
        const database = { execute: async (query: SQL) => { executed = query; return { count: 3 } as never; } } as never;
        assert.deepEqual(await pruneAskHistory({ now: new Date('2026-10-26T16:00:00.000Z'), database }), { deleted: 3 });
        const { sql, params } = new PgDialect().sqlToQuery(executed!);
        assert.match(sql.replace(/\s+/g, ' '), /^ delete from "ask_messages" where "ask_messages"."created_at" < \$1::timestamp and \( "ask_messages"."cleared" or \("ask_messages"."user_id", "ask_messages"."id"\) not in \( select user_id, id from \( select user_id, id, row_number\(\) over \(partition by user_id order by created_at desc, id desc\) as place from "ask_messages" where not cleared \) as kept where place <= \$2 \) \) $/);
        assert.deepEqual(params, ['2026-10-25T16:00:00.000Z', ASK_HISTORY_LIMIT]);
        void buildPruneAllAskHistoryQuery;
    });

    test('one question at a time per user', async () => {
        let executed = '';
        await buildLockAskQuery('user-a', { execute: async (query: unknown) => { executed = JSON.stringify(query); return [] as never; } } as never);
        assert.match(executed, /pg_advisory_xact_lock/);
        assert.match(executed, /atlas:ask:user-a/);
    });
});
