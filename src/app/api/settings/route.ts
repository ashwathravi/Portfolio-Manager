/**
 * PUT /api/settings
 *
 * Saves the signed-in user's settings document (launch item i37): the
 * persisted slices of the settings store, at the store's schema version. The
 * whole document replaces the stored one; the browser sends it after every
 * change (src/lib/settings/sync.ts).
 *
 * Body:     { version: number, settings: { [slice]: object | list } }
 * Response: { data: { updatedAt } }
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { saveUserSettings } from '@/lib/settings/server';
import { settingsDocumentSchema } from '@/lib/validators/user-settings';

export const dynamic = 'force-dynamic';

/** Keepalive requests (sent as a page closes) can't exceed 64 KiB. */
const MAX_BODY_BYTES = 64 * 1024;

export async function PUT(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Settings are too large.', 'SETTINGS_TOO_LARGE', 413)
            : apiError('Invalid settings', 'INVALID_SETTINGS', 400);
    }
    const parsed = settingsDocumentSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid settings', 'INVALID_SETTINGS', 400);
    }

    try {
        const saved = await saveUserSettings(auth.context.userId, parsed.data);
        return NextResponse.json({ data: saved }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to save settings.', 'SETTINGS_SAVE_FAILED');
    }
}
