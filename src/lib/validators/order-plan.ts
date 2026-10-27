import { z } from 'zod';

import { PRE_TRADE_RISK_POLICY_RULE_TYPES } from '@/lib/risk-policy/execution';
import {
    CONVICTION_MAX,
    CONVICTION_MIN,
    MOOD_META,
    RATIONALE_MAX_CHARS,
    SETUP_META,
    type Mood,
    type SetupType,
} from '@/types/trade';

import { safeText } from './common';
import { optionContractTypeSchema, orderSideSchema, orderTypeSchema, timeInForceSchema } from './execution';
import { tickerSchema } from './market-data';
import { recordIdSchema } from './research-ids';

/**
 * Order plans as the Trade ticket sends them (launch item i53), and the
 * status changes the blotter asks for. Atlas never routes an order: a plan
 * is the user's record of what they mean to place at their broker, so the
 * server checks its shape and ownership; the ticket enforces the user's
 * own gates (rationale, risk policy) before sending it.
 */

export const ORDER_PLAN_LIMITS = {
    /** As the ticket's fields allow. */
    whatMustBeTrueByExpiry: 240,
    plannedExitRule: 180,
    overrideReason: 240,
    policySummary: 300,
    policyMessage: 400,
    policyExceptions: 20,
    /** Plans one user can keep, cancelled and placed ones included. */
    perUser: 5_000,
} as const;

const MAX_PRICE = 1e9;
const MAX_QUANTITY = 1e9;

const price = (name: string) => z.number({ message: `${name} must be a number` })
    .finite(`${name} must be a number`)
    .positive(`${name} must be more than 0`)
    .max(MAX_PRICE, `${name} is out of range`);

const text = (name: string, max: number) => safeText.trim().max(max, `${name} must be at most ${max} characters`);

const MOODS = MOOD_META.map((mood) => mood.value) as [Mood, ...Mood[]];
const SETUPS = SETUP_META.map((setup) => setup.value) as [SetupType, ...SetupType[]];

/** The pre-trade rationale (AR-109), as `finalizeRationale` captures it. */
export const tradeRationaleSchema = z.object({
    thesisId: recordIdSchema,
    setupType: z.enum(SETUPS, { message: 'setupType must be one of ' + SETUPS.join(', ') }),
    conviction: z.number({ message: 'conviction must be a number' }).finite()
        .min(CONVICTION_MIN, `conviction must be ${CONVICTION_MIN} to ${CONVICTION_MAX}`)
        .max(CONVICTION_MAX, `conviction must be ${CONVICTION_MIN} to ${CONVICTION_MAX}`),
    mood: z.enum(MOODS, { message: 'mood must be one of ' + MOODS.join(', ') }),
    rationale: text('rationale', RATIONALE_MAX_CHARS).min(1, 'Write the rationale'),
    capturedAt: z.iso.datetime({ message: 'capturedAt must be an ISO time' }),
    timeToDecisionMs: z.number().int('timeToDecisionMs must be a whole number').min(0, "timeToDecisionMs can't be negative").max(Number.MAX_SAFE_INTEGER),
}).strict();

export const orderOptionDetailsSchema = z.object({
    underlying: tickerSchema,
    contractType: optionContractTypeSchema,
    strike: price('strike'),
    expiry: z.iso.date({ message: 'expiry must be a date (YYYY-MM-DD)' }),
    premium: price('premium'),
    contractMultiplier: z.literal(100, { message: 'contractMultiplier must be 100' }),
    premiumAtRisk: z.number().finite().min(0).max(1e15),
    notionalEquivalent: z.number().finite().min(0).max(1e15),
    maxLossAcknowledged: z.boolean(),
    whatMustBeTrueByExpiry: text('whatMustBeTrueByExpiry', ORDER_PLAN_LIMITS.whatMustBeTrueByExpiry),
    plannedExitRule: text('plannedExitRule', ORDER_PLAN_LIMITS.plannedExitRule),
}).strict();

const pct = z.number().finite().min(-1e6).max(1e6);

export const riskPolicyExceptionSchema = z.object({
    ruleType: z.enum(PRE_TRADE_RISK_POLICY_RULE_TYPES),
    symbol: tickerSchema,
    reason: text('reason', ORDER_PLAN_LIMITS.overrideReason),
    currentPct: pct,
    postPct: pct,
    thresholdPct: pct,
    message: text('message', ORDER_PLAN_LIMITS.policyMessage),
    capturedAt: z.iso.datetime({ message: 'capturedAt must be an ISO time' }),
}).strict();

export const orderPolicyRecordSchema = z.object({
    decision: z.enum(['allowed', 'override_required', 'blocked']),
    summary: text('summary', ORDER_PLAN_LIMITS.policySummary),
    exceptions: z.array(riskPolicyExceptionSchema)
        .max(ORDER_PLAN_LIMITS.policyExceptions, `At most ${ORDER_PLAN_LIMITS.policyExceptions} policy exceptions`),
    overrideReason: text('overrideReason', ORDER_PLAN_LIMITS.overrideReason).optional(),
}).strict();

/** POST /api/orders: one plan, for one of the user's accounts. */
export const orderPlanCreateSchema = z.object({
    portfolioId: z.guid('Choose an account'),
    instrumentType: z.enum(['equity', 'option']),
    ticker: tickerSchema,
    side: orderSideSchema,
    type: orderTypeSchema,
    quantity: z.number({ message: 'quantity must be a number' }).finite()
        .positive('quantity must be more than 0').max(MAX_QUANTITY, 'quantity is out of range'),
    limitPrice: price('limitPrice').optional(),
    stopPrice: price('stopPrice').optional(),
    timeInForce: timeInForceSchema,
    referencePrice: price('referencePrice').optional(),
    referencePriceDate: z.iso.date({ message: 'referencePriceDate must be a date (YYYY-MM-DD)' }).optional(),
    needsApproval: z.boolean(),
    rationale: tradeRationaleSchema.optional(),
    optionDetails: orderOptionDetailsSchema.optional(),
    policy: orderPolicyRecordSchema.optional(),
}).strict()
    .refine((plan) => !(plan.type === 'limit' || plan.type === 'stop_limit') || plan.limitPrice != null, {
        message: 'A limit order needs a limit price', path: ['limitPrice'],
    })
    .refine((plan) => !(plan.type === 'stop' || plan.type === 'stop_limit') || plan.stopPrice != null, {
        message: 'A stop order needs a stop price', path: ['stopPrice'],
    })
    .refine((plan) => plan.limitPrice == null || plan.type === 'limit' || plan.type === 'stop_limit', {
        message: 'Only limit orders have a limit price', path: ['limitPrice'],
    })
    .refine((plan) => plan.stopPrice == null || plan.type === 'stop' || plan.type === 'stop_limit', {
        message: 'Only stop orders have a stop price', path: ['stopPrice'],
    })
    .refine((plan) => plan.type !== 'market' || plan.referencePrice != null, {
        message: 'A market order needs the price it was sized at', path: ['referencePrice'],
    })
    .refine((plan) => plan.referencePriceDate == null || plan.referencePrice != null, {
        message: 'referencePriceDate goes with a referencePrice', path: ['referencePriceDate'],
    })
    .refine((plan) => (plan.instrumentType === 'option') === (plan.optionDetails != null), {
        message: 'Option orders, and only they, have option details', path: ['optionDetails'],
    })
    .refine((plan) => plan.optionDetails == null || plan.optionDetails.underlying === plan.ticker, {
        message: "The option's underlying must be the ticker", path: ['optionDetails', 'underlying'],
    })
    .refine((plan) => plan.instrumentType !== 'option' || (plan.side === 'buy' && plan.type === 'limit'), {
        message: 'Option plans are limit buys', path: ['type'],
    })
    .refine((plan) => Number.isInteger(plan.quantity) || plan.instrumentType === 'equity', {
        message: 'Option contracts are whole numbers', path: ['quantity'],
    });

export type OrderPlanCreate = z.infer<typeof orderPlanCreateSchema>;

/** PATCH /api/orders/[id]: approve a plan (ready), mark it placed, or cancel it. */
export const orderPlanStatusSchema = z.object({
    status: z.enum(['ready', 'placed', 'cancelled'], { message: 'status must be ready, placed or cancelled' }),
}).strict();

export type OrderPlanStatusChange = z.infer<typeof orderPlanStatusSchema>;
