import { z } from 'zod';

import { ADHERENCE_RULE_ORDER, type AdherenceRuleType } from '@/lib/adherence/rules';
import { STRATEGY_LIMITS, STRATEGY_OPS, type StrategyOp } from '@/lib/strategies/strategy';

import { safeText } from './common';
import { tickerSchema } from './market-data';

/**
 * Strategies as the builder saves them (launch item i55). A rule's text is
 * kept as typed, within its length, so a half-written rule saves like the
 * rest of the draft; the backtest says which rule it can't read.
 */

const localId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'id must be letters, digits, _ or -');

const ruleText = (name: string) => safeText.trim()
    .min(1, `${name} is required`)
    .max(STRATEGY_LIMITS.ruleText, `${name} must be at most ${STRATEGY_LIMITS.ruleText} characters`);

export const strategyRuleSchema = z.object({
    id: localId,
    field: ruleText('field'),
    op: z.enum(STRATEGY_OPS as [StrategyOp, ...StrategyOp[]], { message: `op must be one of ${STRATEGY_OPS.join(', ')}` }),
    value: ruleText('value'),
}).strict();

const fraction = (name: string, min: number, max: number) => z.number({ message: `${name} must be a number` })
    .finite(`${name} must be a number`)
    .min(min, `${name} must be ${min} to ${max}`)
    .max(max, `${name} must be ${min} to ${max}`);

export const strategyDefinitionSchema = z.object({
    rules: z.array(strategyRuleSchema).max(STRATEGY_LIMITS.rules, `at most ${STRATEGY_LIMITS.rules} rules`),
    conjunctions: z.array(z.enum(['AND', 'OR'], { message: 'conjunctions must be AND or OR' })),
    symbols: z.array(tickerSchema).max(STRATEGY_LIMITS.symbols, `at most ${STRATEGY_LIMITS.symbols} tickers`)
        .refine((s) => new Set(s).size === s.length, 'symbols must not repeat'),
    guardrails: z.object({
        maxPositionPct: fraction('maxPositionPct', 0.005, 1),
        stopLossPct: fraction('stopLossPct', 0.01, 0.5),
        rebalanceDays: z.number({ message: 'rebalanceDays must be a number' }).int('rebalanceDays must be a whole number')
            .min(1, 'rebalanceDays must be 1 to 90').max(90, 'rebalanceDays must be 1 to 90'),
    }).strict(),
}).strict().refine((d) => d.conjunctions.length === Math.max(0, d.rules.length - 1), {
    message: 'conjunctions must be one fewer than rules',
    path: ['conjunctions'],
});

const hour = z.number().int().min(0).max(24);

export const adherenceRuleSchema = z.object({
    id: localId,
    type: z.enum(ADHERENCE_RULE_ORDER as [AdherenceRuleType, ...AdherenceRuleType[]], { message: 'unknown adherence rule type' }),
    params: z.object({
        pct: z.number().finite().min(0).max(100).optional(),
        sector: safeText.trim().max(60).optional(),
        days: z.number().int().min(0).max(365).optional(),
        value: z.number().finite().min(0).max(10).optional(),
        fromHour: hour.optional(),
        toHour: hour.optional(),
    }).strict(),
    severity: z.enum(['hard', 'soft']),
}).strict();

export const strategyInputSchema = z.object({
    name: safeText.trim().min(1, 'Name the strategy').max(STRATEGY_LIMITS.name, `name must be at most ${STRATEGY_LIMITS.name} characters`),
    description: safeText.trim().max(STRATEGY_LIMITS.description, `description must be at most ${STRATEGY_LIMITS.description} characters`).default(''),
    definition: strategyDefinitionSchema,
    adherenceRules: z.array(adherenceRuleSchema)
        .max(STRATEGY_LIMITS.adherenceRules, `at most ${STRATEGY_LIMITS.adherenceRules} adherence rules`).default([]),
}).strict();

export type StrategyInput = z.infer<typeof strategyInputSchema>;
