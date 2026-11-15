/**
 * POST /api/strategies
 *
 * Saves a new strategy to the signed-in user's account (launch item i55):
 * its rules, tickers, guardrails and discipline rules. Its tickers start
 * being tracked in the price store, so their history arrives for backtests.
 *
 * Body:     { name, description?, definition: { rules, conjunctions, symbols, guardrails }, adherenceRules? }
 * Response: 201 { data: Strategy }; 400 INVALID_STRATEGY; 409 STRATEGY_LIMIT
 */

import { NextResponse } from 'next/server';

import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { STRATEGY_LIMITS } from '@/lib/strategies/strategy';
import { createStrategy, StrategyLimitError } from '@/lib/strategies/store';

import { parseStrategyBody } from '@/lib/api/strategy-request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseStrategyBody(request);
    if (!parsed.ok) return parsed.response;

    try {
        const strategy = await createStrategy(auth.context.userId, parsed.input);
        return NextResponse.json({ data: strategy }, { status: 201 });
    } catch (err) {
        if (err instanceof StrategyLimitError) {
            return apiError(`You can keep at most ${STRATEGY_LIMITS.perUser} strategies.`, 'STRATEGY_LIMIT', 409);
        }
        return internalServerError(err, 'Unable to save the strategy.', 'STRATEGY_CREATE_FAILED');
    }
}
