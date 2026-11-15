/**
 * POST /api/strategies/[id]/backtest
 *
 * Runs the saved strategy's backtest over the price store's daily bars and
 * keeps the result with it (launch item i55; src/lib/strategies/backtest.ts
 * says how a run works).
 *
 * Responses: 200 { data: Strategy }; 404 STRATEGY_NOT_FOUND;
 *            422 NO_RULES | INVALID_RULE | NO_SYMBOLS | NO_HISTORY | SHORT_HISTORY, with a message to show;
 *            429 DAILY_QUOTA_REACHED (the day's backtests)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { consumeDailyQuota } from '@/lib/api/daily-quota';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { runStrategyBacktest } from '@/lib/strategies/store';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const notFound = () => apiError('Strategy not found', 'STRATEGY_NOT_FOUND', 404);
    if (!idSchema.safeParse(id).success) return notFound();
    const overQuota = await consumeDailyQuota(auth.context.userId, 'backtests');
    if (overQuota) return overQuota;

    try {
        const run = await runStrategyBacktest(auth.context.userId, id);
        if (!run) return notFound();
        if (!run.outcome.ok) return apiError(run.outcome.message, run.outcome.code, 422);
        return NextResponse.json({ data: run.strategy });
    } catch (err) {
        return internalServerError(err, 'Unable to run the backtest.', 'BACKTEST_FAILED');
    }
}
