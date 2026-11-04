/**
 * /api/email/preferences — which emails the signed-in user gets (launch
 * item i58): their alerts each weekday evening, and the weekly review after
 * Friday's close. Both are off until turned on.
 *
 * GET  Response: { data: { alerts, weeklyReview, address, sending, stored } }.
 *      `address` is the account's Google address, where they go; `sending`
 *      says whether this server sends email at all.
 * PUT  { alerts?: boolean, weeklyReview?: boolean } → 200 { data: { alerts, weeklyReview } }.
 *      400 INVALID_EMAIL_PREFERENCES, 413.
 *
 * Without a database (local runs) nothing is kept (`stored: false`) and
 * PUT answers 503 EMAIL_PREFERENCES_NOT_STORED.
 */

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { isEmailConfigured } from '@/lib/email/config';
import { loadEmailPreferences, saveEmailPreferences } from '@/lib/email/preferences';
import { EMAIL_PREFERENCES_MAX_BYTES, emailPreferencesInputSchema } from '@/lib/validators/email';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const sending = isEmailConfigured();
    if (!isDatabaseConfigured()) {
        return NextResponse.json({ data: { alerts: false, weeklyReview: false, address: null, sending, stored: false } }, { headers: NO_STORE });
    }
    try {
        const preferences = await loadEmailPreferences(auth.context.userId);
        return NextResponse.json({ data: { ...preferences, sending, stored: true } }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to load your email settings.', 'EMAIL_PREFERENCES_LOAD_FAILED');
    }
}

export async function PUT(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return apiError('Email settings are kept with your account, and this server has no database.', 'EMAIL_PREFERENCES_NOT_STORED', 503);
    }

    const body = await readJsonBody(request, EMAIL_PREFERENCES_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Request is too large.', 'EMAIL_PREFERENCES_TOO_LARGE', 413)
            : apiError('Invalid email settings', 'INVALID_EMAIL_PREFERENCES', 400);
    }
    const parsed = emailPreferencesInputSchema.safeParse(body.value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.');
        return apiError(field ? `${field}: ${issue.message}` : issue?.message ?? 'Invalid email settings', 'INVALID_EMAIL_PREFERENCES', 400);
    }

    try {
        const saved = await saveEmailPreferences(auth.context.userId, parsed.data);
        return NextResponse.json({ data: saved }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to save your email settings.', 'EMAIL_PREFERENCES_SAVE_FAILED');
    }
}
