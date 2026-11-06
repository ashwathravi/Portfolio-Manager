/**
 * POST /api/email/unsubscribe?token=…&list=alerts|weekly_review
 *
 * One-click unsubscribe (launch item i58, RFC 8058): the address in each
 * email's List-Unsubscribe header, which a mail app posts to with the body
 * "List-Unsubscribe=One-Click". No session: the token in the link, random
 * and the recipient's own, is all it takes, and all it can do is turn that
 * one email off. The body isn't read. Limited per IP in the proxy.
 *
 * Response: 200 { data: { unsubscribed: list } }; 400 INVALID_UNSUBSCRIBE_LINK;
 *           404 UNSUBSCRIBE_LINK_NOT_FOUND; 503 EMAIL_PREFERENCES_NOT_STORED
 */

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { apiError, internalServerError } from '@/lib/api/security';
import { unsubscribe } from '@/lib/email/preferences';
import { unsubscribeSchema } from '@/lib/validators/email';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const params = new URL(request.url).searchParams;
    const parsed = unsubscribeSchema.safeParse({ token: params.get('token'), list: params.get('list') });
    if (!parsed.success) return apiError('This unsubscribe link is incomplete.', 'INVALID_UNSUBSCRIBE_LINK', 400);
    if (!isDatabaseConfigured()) {
        return apiError('Email settings are kept with your account, and this server has no database.', 'EMAIL_PREFERENCES_NOT_STORED', 503);
    }

    try {
        if (!(await unsubscribe(parsed.data.token, parsed.data.list))) {
            return apiError('This unsubscribe link isn\'t valid.', 'UNSUBSCRIBE_LINK_NOT_FOUND', 404);
        }
        return NextResponse.json({ data: { unsubscribed: parsed.data.list } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to unsubscribe.', 'UNSUBSCRIBE_FAILED');
    }
}
