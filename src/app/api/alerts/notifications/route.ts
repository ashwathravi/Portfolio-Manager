/**
 * /api/alerts/notifications — what the signed-in user's alert rules found
 * (launch item i57), the feed behind the bell in the top bar.
 *
 * GET     Response: { data: { notifications: AlertTrigger[], unread, stored } }, newest first.
 * PATCH   { ids: string[] } or { all: true } marks them read → 204. Others' IDs are ignored.
 *         400 INVALID_ALERT_READ, 413.
 * DELETE  Clears the feed; the rules stay → 204. Each cleared alert keeps only
 *         which rule fired for what, so it isn't raised again.
 *
 * Without a database (local runs) the feed is empty (`stored: false`).
 */

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { clearAlertNotifications, loadAlertFeed, markAlertNotificationsRead } from '@/lib/alerts/server/notifications';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { ALERT_READ_MAX_BYTES, alertNotificationsReadSchema } from '@/lib/validators/alerts';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return NextResponse.json({ data: { notifications: [], unread: 0, stored: false } }, { headers: NO_STORE });
    }
    try {
        const feed = await loadAlertFeed(auth.context.userId);
        return NextResponse.json({ data: { ...feed, stored: true } }, { headers: NO_STORE });
    } catch (err) {
        return internalServerError(err, 'Unable to load your alerts.', 'ALERT_FEED_LOAD_FAILED');
    }
}

export async function PATCH(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, ALERT_READ_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Request is too large.', 'ALERT_READ_TOO_LARGE', 413)
            : apiError('Invalid request', 'INVALID_ALERT_READ', 400);
    }
    const parsed = alertNotificationsReadSchema.safeParse(body.value);
    if (!parsed.success) return apiError('Send { ids: [...] } or { all: true }', 'INVALID_ALERT_READ', 400);
    if (!isDatabaseConfigured()) return new NextResponse(null, { status: 204 });

    try {
        await markAlertNotificationsRead(auth.context.userId, parsed.data);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to mark alerts read.', 'ALERT_READ_FAILED');
    }
}

export async function DELETE(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) return new NextResponse(null, { status: 204 });
    try {
        await clearAlertNotifications(auth.context.userId);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to clear your alerts.', 'ALERT_FEED_CLEAR_FAILED');
    }
}
