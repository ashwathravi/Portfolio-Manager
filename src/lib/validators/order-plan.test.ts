import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RATIONALE_MAX_CHARS } from '@/types/trade';

import { ORDER_PLAN_LIMITS, orderPlanCreateSchema, orderPlanStatusSchema } from './order-plan';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';

const RATIONALE = {
    thesisId: '6f1c2a3b-0000-4000-8000-000000000abc',
    setupType: 'breakout',
    conviction: 7.5,
    mood: 'focused',
    rationale: 'Breaking out of a six-month base on earnings.',
    capturedAt: '2026-10-27T15:00:00.000Z',
    timeToDecisionMs: 42_000,
};

const OPTION = {
    underlying: 'IBM',
    contractType: 'call',
    strike: 250,
    expiry: '2027-01-15',
    premium: 4.5,
    contractMultiplier: 100,
    premiumAtRisk: 450,
    notionalEquivalent: 25_000,
    maxLossAcknowledged: true,
    whatMustBeTrueByExpiry: 'Software margins expand.',
    plannedExitRule: 'Close at a 50% loss.',
};

const EXCEPTION = {
    ruleType: 'single_position_allocation',
    symbol: 'IBM',
    reason: 'Planned rebalance into IBM',
    currentPct: 20,
    postPct: 30,
    thresholdPct: 25,
    message: 'IBM would be 30% of the portfolio.',
    capturedAt: '2026-10-27T15:00:00.000Z',
};

const valid = (overrides: Record<string, unknown> = {}) => ({
    portfolioId: ACCOUNT,
    instrumentType: 'equity',
    ticker: 'IBM',
    side: 'buy',
    type: 'limit',
    quantity: 3,
    limitPrice: 204,
    timeInForce: 'day',
    referencePrice: 205,
    referencePriceDate: '2026-10-27',
    needsApproval: false,
    rationale: RATIONALE,
    policy: { decision: 'allowed', summary: 'Inside policy', exceptions: [] },
    ...overrides,
});

function message(input: unknown): string | undefined {
    const result = orderPlanCreateSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('orderPlanCreateSchema', () => {
    test('accepts a limit buy with a rationale and the policy verdict', () => {
        assert.equal(orderPlanCreateSchema.safeParse(valid()).success, true);
    });

    test('accepts each order type with the prices it uses', () => {
        assert.equal(message(valid({ type: 'market', limitPrice: undefined })), undefined);
        assert.equal(message(valid({ type: 'stop', limitPrice: undefined, stopPrice: 199 })), undefined);
        assert.equal(message(valid({ type: 'stop_limit', stopPrice: 199 })), undefined);
    });

    test('accepts a plan without a rationale (the setting is off), a price, or a policy record', () => {
        assert.equal(message(valid({ rationale: undefined, referencePrice: undefined, referencePriceDate: undefined, policy: undefined })), undefined);
    });

    test('accepts fractional shares and an overridden policy exception', () => {
        assert.equal(message(valid({ quantity: 0.5 })), undefined);
        assert.equal(message(valid({
            policy: { decision: 'override_required', summary: 'Override captured', exceptions: [EXCEPTION], overrideReason: 'Planned rebalance into IBM' },
        })), undefined);
    });

    test('accepts an option plan: a limit buy of whole contracts with its details', () => {
        assert.equal(message(valid({ instrumentType: 'option', quantity: 1, limitPrice: 4.5, referencePrice: undefined, referencePriceDate: undefined, optionDetails: OPTION })), undefined);
    });

    test('needs an account, a valid ticker and a known side, type and time in force', () => {
        assert.equal(message(valid({ portfolioId: 'p-growth' })), 'Choose an account');
        assert.ok(message(valid({ ticker: 'ibm' })));
        assert.ok(message(valid({ ticker: '<b>' })));
        assert.ok(message(valid({ side: 'short' })));
        assert.ok(message(valid({ type: 'trailing_stop' })));
        assert.ok(message(valid({ timeInForce: 'opg' })));
        assert.ok(message(valid({ instrumentType: 'future' })));
    });

    test('quantity is more than 0 and at most a billion', () => {
        assert.equal(message(valid({ quantity: 0 })), 'quantity must be more than 0');
        assert.equal(message(valid({ quantity: -1 })), 'quantity must be more than 0');
        assert.equal(message(valid({ quantity: 1e9 })), undefined);
        assert.equal(message(valid({ quantity: 1e9 + 1 })), 'quantity is out of range');
        assert.equal(message(valid({ quantity: '3' })), 'quantity must be a number');
    });

    test('prices are more than 0', () => {
        assert.equal(message(valid({ limitPrice: 0 })), 'limitPrice must be more than 0');
        assert.equal(message(valid({ referencePrice: -1 })), 'referencePrice must be more than 0');
        assert.equal(message(valid({ limitPrice: 1e9 + 1 })), 'limitPrice is out of range');
    });

    test('each order type has the prices it uses, and only those', () => {
        assert.equal(message(valid({ limitPrice: undefined })), 'A limit order needs a limit price');
        assert.equal(message(valid({ type: 'stop', limitPrice: undefined })), 'A stop order needs a stop price');
        assert.equal(message(valid({ type: 'market' })), 'Only limit orders have a limit price');
        assert.equal(message(valid({ type: 'market', limitPrice: undefined, stopPrice: 199 })), 'Only stop orders have a stop price');
    });

    test('a market order needs the price it was sized at, and a close date needs its price', () => {
        assert.equal(message(valid({ type: 'market', limitPrice: undefined, referencePrice: undefined, referencePriceDate: undefined })),
            'A market order needs the price it was sized at');
        assert.equal(message(valid({ referencePrice: undefined })), 'referencePriceDate goes with a referencePrice');
        assert.equal(message(valid({ referencePriceDate: '27/10/2026' })), 'referencePriceDate must be a date (YYYY-MM-DD)');
    });

    test('option details go with option plans only, for the same underlying, as a limit buy of whole contracts', () => {
        assert.equal(message(valid({ optionDetails: OPTION })), 'Option orders, and only they, have option details');
        assert.equal(message(valid({ instrumentType: 'option' })), 'Option orders, and only they, have option details');
        const option = (overrides: Record<string, unknown>) =>
            valid({ instrumentType: 'option', quantity: 1, limitPrice: 4.5, referencePrice: undefined, referencePriceDate: undefined, optionDetails: OPTION, ...overrides });
        assert.equal(message(option({ ticker: 'MSFT' })), "The option's underlying must be the ticker");
        assert.equal(message(option({ side: 'sell' })), 'Option plans are limit buys');
        assert.equal(message(option({ type: 'market', limitPrice: undefined, referencePrice: 4.5 })), 'Option plans are limit buys');
        assert.equal(message(option({ quantity: 1.5 })), 'Option contracts are whole numbers');
        assert.equal(message(option({ optionDetails: { ...OPTION, contractMultiplier: 10 } })), 'contractMultiplier must be 100');
        assert.equal(message(option({ optionDetails: { ...OPTION, expiry: 'Jan 2027' } })), 'expiry must be a date (YYYY-MM-DD)');
        assert.equal(message(option({ optionDetails: { ...OPTION, plannedExitRule: 'x'.repeat(181) } })), 'plannedExitRule must be at most 180 characters');
        assert.equal(message(option({ optionDetails: { ...OPTION, whatMustBeTrueByExpiry: 'x'.repeat(240) } })), undefined);
    });

    test('the rationale is complete and within its limits', () => {
        const rationale = (overrides: Record<string, unknown>) => valid({ rationale: { ...RATIONALE, ...overrides } });
        assert.equal(message(rationale({ rationale: 'x'.repeat(RATIONALE_MAX_CHARS) })), undefined);
        assert.equal(message(rationale({ rationale: 'x'.repeat(RATIONALE_MAX_CHARS + 1) })), `rationale must be at most ${RATIONALE_MAX_CHARS} characters`);
        assert.equal(message(rationale({ rationale: '   ' })), 'Write the rationale');
        assert.equal(message(rationale({ conviction: 0.9 })), 'conviction must be 1 to 10');
        assert.equal(message(rationale({ conviction: 10 })), undefined);
        assert.equal(message(rationale({ conviction: 10.1 })), 'conviction must be 1 to 10');
        assert.ok(message(rationale({ mood: 'euphoric' }))?.startsWith('mood must be one of'));
        assert.ok(message(rationale({ setupType: 'yolo' }))?.startsWith('setupType must be one of'));
        assert.equal(message(rationale({ thesisId: 'Seed NVDA' })), 'id must be lowercase letters, digits, dots and hyphens');
        assert.equal(message(rationale({ timeToDecisionMs: -1 })), "timeToDecisionMs can't be negative");
        assert.equal(message(rationale({ capturedAt: 'yesterday' })), 'capturedAt must be an ISO time');
        assert.ok(message(rationale({ extra: true })));
    });

    test('the policy record is bounded and its exceptions name known rules', () => {
        const policy = (overrides: Record<string, unknown>) =>
            valid({ policy: { decision: 'override_required', summary: 'Override captured', exceptions: [EXCEPTION], ...overrides } });
        assert.equal(message(policy({ exceptions: Array(ORDER_PLAN_LIMITS.policyExceptions).fill(EXCEPTION) })), undefined);
        assert.equal(message(policy({ exceptions: Array(ORDER_PLAN_LIMITS.policyExceptions + 1).fill(EXCEPTION) })), 'At most 20 policy exceptions');
        assert.ok(message(policy({ exceptions: [{ ...EXCEPTION, ruleType: 'made_up_rule' }] })));
        assert.equal(message(policy({ overrideReason: 'x'.repeat(241) })), 'overrideReason must be at most 240 characters');
        assert.equal(message(policy({ summary: 'x'.repeat(301) })), 'summary must be at most 300 characters');
        assert.ok(message(policy({ decision: 'maybe' })));
        assert.equal(message(policy({ overrideReason: '<script>' })), 'Input contains invalid characters (< or >)');
    });

    test('refuses fields the ticket never sends, such as a status or a user', () => {
        assert.ok(message(valid({ status: 'placed' })));
        assert.ok(message(valid({ userId: 'someone-else' })));
        assert.ok(message(valid({ needsApproval: undefined })));
    });
});

describe('orderPlanStatusSchema', () => {
    test('accepts approving, placing and cancelling', () => {
        for (const status of ['ready', 'placed', 'cancelled']) {
            assert.equal(orderPlanStatusSchema.safeParse({ status }).success, true, status);
        }
    });

    test('refuses going back to needing approval, unknown statuses and extra fields', () => {
        for (const body of [{ status: 'pending_approval' }, { status: 'filled' }, {}, { status: 'ready', quantity: 5 }]) {
            assert.equal(orderPlanStatusSchema.safeParse(body).success, false, JSON.stringify(body));
        }
        const result = orderPlanStatusSchema.safeParse({ status: 'filled' });
        assert.equal(result.success ? undefined : result.error.issues[0]?.message, 'status must be ready, placed or cancelled');
    });
});
