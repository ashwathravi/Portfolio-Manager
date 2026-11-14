import { z } from 'zod';

import { safeText } from './common';

/**
 * Alert rules (launch item i57): the form in Settings › Alerts, and the
 * bodies of /api/alerts. A rule's threshold is in its metric's units:
 * dollars for a price or the accounts' value, a fraction (0.05 = 5%) for a
 * daily change, a score out of 100 for Alpha Radar.
 */

export const ALERT_METRICS = [
    'price',
    'price_change_pct',
    'portfolio_value',
    'portfolio_day_change_pct',
    'alpha_radar_new_position',
    'alpha_radar_exit',
    'alpha_radar_large_add',
    'alpha_radar_large_trim',
    'alpha_radar_user_overlap',
] as const;

/** Rules one account can have. */
export const ALERT_RULES_PER_USER = 50;
export const ALERT_RULE_MAX_BYTES = 4 * 1024;
export const ALERT_READ_MAX_BYTES = 16 * 1024;

const alertRuleFields = z.object({
    name: z.string().trim().min(1, "Name is required").max(60, "Name is too long").pipe(safeText),
    metric: z.enum(ALERT_METRICS),
    symbol: z.string().trim().toUpperCase().max(10, "Symbol is too long")
        .regex(/^(?:[A-Z0-9]+(?:[.-][A-Z0-9]+)*)?$/, "Invalid symbol")
        .optional(),
    comparator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
    threshold: z.number().finite(),
    enabled: z.boolean(),
    rearm: z.enum(['once', 'always', 'daily']),
    note: z.string().trim().max(200, "Note is too long").pipe(safeText).optional(),
});

type AlertRuleFields = z.infer<typeof alertRuleFields>;

export function needsSymbol(metric: AlertRuleFields['metric']): boolean {
    return metric === 'price' || metric === 'price_change_pct';
}

function checkRule(data: AlertRuleFields, ctx: z.RefinementCtx) {
    if (needsSymbol(data.metric) && !data.symbol) {
        ctx.addIssue({ code: 'custom', message: "Symbol is required for this metric", path: ['symbol'] });
    }
    if (data.metric.startsWith('alpha_radar_')) {
        if (data.threshold < 0 || data.threshold > 100) {
            ctx.addIssue({ code: 'custom', message: "Alpha Radar materiality score must be between 0 and 100", path: ['threshold'] });
        }
    } else if (data.metric === 'price' || data.metric === 'portfolio_value') {
        if (data.threshold < 0) {
            ctx.addIssue({ code: 'custom', message: "Threshold can't be negative", path: ['threshold'] });
        }
    } else if (data.threshold < -1 || data.threshold > 10) {
        ctx.addIssue({ code: 'custom', message: "Use a fraction between -1 and 10 (0.05 = 5%)", path: ['threshold'] });
    }
}

/** The Settings form: the symbol and note may be left blank. */
export const alertRuleSchema = alertRuleFields
    .extend({
        symbol: alertRuleFields.shape.symbol.or(z.literal('')),
        note: alertRuleFields.shape.note.or(z.literal('')),
    })
    .superRefine((data, ctx) => checkRule({ ...data, symbol: data.symbol || undefined }, ctx));

export type AlertRuleFormValues = z.infer<typeof alertRuleSchema>;

/**
 * A rule as POST /api/alerts/rules and PUT /api/alerts/rules/[id] take it,
 * nothing else. A symbol is kept only for the metrics that use one.
 */
export const alertRuleInputSchema = alertRuleFields
    .strict()
    .superRefine(checkRule)
    .transform((data) => ({
        ...data,
        symbol: needsSymbol(data.metric) ? data.symbol! : null,
        note: data.note ? data.note : null,
    }));

export type AlertRuleInput = z.output<typeof alertRuleInputSchema>;

/** PATCH /api/alerts/notifications: mark some notifications read, or all of them. */
export const alertNotificationsReadSchema = z.union([
    z.object({ ids: z.array(z.uuid('ids must be notification ids')).min(1).max(200) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
]);

export type AlertNotificationsRead = z.infer<typeof alertNotificationsReadSchema>;
