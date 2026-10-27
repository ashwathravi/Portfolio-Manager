/**
 * /api/ask — Ask, answered from the signed-in user's own data (launch item
 * i56).
 *
 * GET     The conversation and the questions asked in the last 24 hours.
 *         Response: { data: { messages: AskMessage[], questionsToday, limit, stored } }
 * POST    { question } → the answer, from the user's portfolio, transactions,
 *         theses and saved risk policy. The question and answer are kept
 *         with the account. Past the daily limit: 429 ASK_DAILY_LIMIT.
 *         Response: { data: { messages: [question, answer], questionsToday, limit, stored } }
 * DELETE  Clears the conversation (the day's questions still count).
 *
 * Without a database (local runs) nothing is stored (`stored: false`) and
 * the browser keeps the conversation; the answers have no data to come from.
 */

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { answerQuestion } from '@/lib/ask/server/answer';
import {
    ASK_DAILY_LIMIT,
    AskDailyLimitError,
    clearAskHistory,
    loadAskHistory,
    questionsAsked,
    saveAskTurn,
} from '@/lib/ask/server/history';
import type { AskMessage } from '@/lib/ask/types';
import { askQuestionSchema } from '@/lib/validators/ask';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 4 * 1024;

function dailyLimitReached(): NextResponse {
    return apiError(new AskDailyLimitError().message, 'ASK_DAILY_LIMIT', 429);
}

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return NextResponse.json({ data: { messages: [], questionsToday: 0, limit: ASK_DAILY_LIMIT, stored: false } }, { headers: NO_STORE });
    }
    try {
        const history = await loadAskHistory(auth.context.userId);
        return NextResponse.json({ data: { ...history, limit: ASK_DAILY_LIMIT, stored: true } }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to load the conversation.', 'ASK_HISTORY_LOAD_FAILED');
    }
}

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('That question is too long.', 'QUESTION_TOO_LARGE', 413)
            : apiError('Invalid question', 'INVALID_QUESTION', 400);
    }
    const parsed = askQuestionSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid question', 'INVALID_QUESTION', 400);
    }

    const { userId } = auth.context;
    const stored = isDatabaseConfigured();
    const now = new Date();
    try {
        // Checked before answering, so a user past the limit costs nothing.
        if (stored && (await questionsAsked(userId, now)) >= ASK_DAILY_LIMIT) return dailyLimitReached();

        const answer = await answerQuestion(userId, parsed.data.question, { now });
        const question: AskMessage = { id: randomUUID(), role: 'user', content: parsed.data.question, ts: now.getTime() };
        // A millisecond after the question, so the two always sort in order.
        const reply: AskMessage = {
            id: randomUUID(),
            role: 'assistant',
            content: answer.text,
            citations: answer.citations,
            toolRuns: answer.toolRuns,
            ts: now.getTime() + 1,
        };
        const questionsToday = stored ? await saveAskTurn(userId, [question, reply], now) : 0;
        return NextResponse.json(
            { data: { messages: [question, reply], questionsToday, limit: ASK_DAILY_LIMIT, stored } },
            { headers: NO_STORE },
        );
    } catch (err) {
        if (err instanceof AskDailyLimitError) return dailyLimitReached();
        return internalServerError(err, "Ask couldn't load your data to answer.", 'ASK_FAILED');
    }
}

export async function DELETE(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return NextResponse.json({ data: { cleared: true } }, { headers: NO_STORE });
    }
    try {
        await clearAskHistory(auth.context.userId);
        return NextResponse.json({ data: { cleared: true } }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to clear the conversation.', 'ASK_CLEAR_FAILED');
    }
}
