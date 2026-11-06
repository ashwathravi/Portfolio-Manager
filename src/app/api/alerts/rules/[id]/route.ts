/**
 * /api/alerts/rules/[id] — one of the signed-in user's alert rules (launch
 * item i57).
 *
 * PUT     The whole rule, as POST /api/alerts/rules takes it → { data: AlertRule }.
 *         Turning a paused rule back on lets it fire again.
 * DELETE  The rule and the notifications it raised → 204.
 *
 * Another user's rule, or none, is 404 ALERT_RULE_NOT_FOUND either way.
 * PUT: 400 INVALID_ALERT_RULE (the field named), 413.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { deleteAlertRule, updateAlertRule } from '@/lib/alerts/server/rules';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { ALERT_RULE_MAX_BYTES, alertRuleInputSchema } from '@/lib/validators/alerts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const ruleIdSchema = z.uuid();

function notFound() {
    return apiError('Alert rule not found', 'ALERT_RULE_NOT_FOUND', 404);
}

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const id = ruleIdSchema.safeParse((await params).id);
    if (!id.success) return notFound();

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
        const rule = await updateAlertRule(auth.context.userId, id.data, parsed.data);
        if (!rule) return notFound();
        return NextResponse.json({ data: rule }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to save the alert rule.', 'ALERT_RULE_SAVE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const id = ruleIdSchema.safeParse((await params).id);
    if (!id.success) return notFound();

    try {
        if (!(await deleteAlertRule(auth.context.userId, id.data))) return notFound();
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to delete the alert rule.', 'ALERT_RULE_DELETE_FAILED');
    }
}
