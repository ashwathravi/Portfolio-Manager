/**
 * /api/alerts/rules — the signed-in user's alert rules (launch item i57),
 * evaluated each weekday evening by the nightly "alerts" job.
 *
 * GET   Response: { data: { rules: AlertRule[], limit, stored } }, oldest first.
 * POST  A rule (src/lib/validators/alerts.ts) → 201 { data: AlertRule }.
 *       400 INVALID_ALERT_RULE (the field named), 409 ALERT_RULE_LIMIT, 413.
 *
 * Without a database (local runs) there are no rules (`stored: false`) and
 * none can be saved: 503 ALERTS_NOT_STORED.
 */

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { AlertRuleLimitError, createAlertRule, listAlertRules } from '@/lib/alerts/server/rules';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { ALERT_RULE_MAX_BYTES, ALERT_RULES_PER_USER, alertRuleInputSchema } from '@/lib/validators/alerts';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return NextResponse.json({ data: { rules: [], limit: ALERT_RULES_PER_USER, stored: false } }, { headers: NO_STORE });
    }
    try {
        const rules = await listAlertRules(auth.context.userId);
        return NextResponse.json({ data: { rules, limit: ALERT_RULES_PER_USER, stored: true } }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to load your alert rules.', 'ALERT_RULES_LOAD_FAILED');
    }
}

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return apiError('Alert rules are kept with your account, and this server has no database.', 'ALERTS_NOT_STORED', 503);
    }

    const body = await readJsonBody(request, ALERT_RULE_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Alert rule is too large.', 'ALERT_RULE_TOO_LARGE', 413)
            : apiError('Invalid alert rule', 'INVALID_ALERT_RULE', 400);
    }
    const parsed = alertRuleInputSchema.safeParse(body.value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.');
        return apiError(field ? `${field}: ${issue.message}` : issue?.message ?? 'Invalid alert rule', 'INVALID_ALERT_RULE', 400);
    }

    try {
        const rule = await createAlertRule(auth.context.userId, parsed.data);
        return NextResponse.json({ data: rule }, { status: 201, headers: NO_STORE });
    } catch (err) {
        if (err instanceof AlertRuleLimitError) {
            return apiError(`You can have at most ${ALERT_RULES_PER_USER} alert rules. Delete one to add another.`, 'ALERT_RULE_LIMIT', 409);
        }
        return internalServerError(err, 'Unable to save the alert rule.', 'ALERT_RULE_SAVE_FAILED');
    }
}
