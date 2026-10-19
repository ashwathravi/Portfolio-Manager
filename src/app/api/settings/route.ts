/**
 * PUT /api/settings
 *
 * Saves the signed-in user's settings document (launch item i37): the
 * persisted slices of the settings store, at the store's schema version. The
 * whole document replaces the stored one, but only if it was made on the
 * stored version (`baseUpdatedAt`); otherwise the answer is 409 with what's
 * stored now, which the browser takes instead (src/lib/settings/sync.ts).
 *
 * Body:     { version: number, settings: { [slice]: object | list }, baseUpdatedAt: string | null }
 * Response: { data: { updatedAt } }, or 409 { error, code: SETTINGS_CONFLICT, data: { document } }
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { saveUserSettings } from '@/lib/settings/server';
import { settingsDocumentSchema } from '@/lib/validators/user-settings';

export const dynamic = 'force-dynamic';

/** Generous: lists and notes in the risk policy can grow. */
const MAX_BODY_BYTES = 512 * 1024;

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
        const { baseUpdatedAt, ...document } = parsed.data;
        const result = await saveUserSettings(auth.context.userId, document, baseUpdatedAt);
        if (result.status === 'conflict') {
            return NextResponse.json(
                { error: 'Settings changed since this copy was made.', code: 'SETTINGS_CONFLICT', data: { document: result.current } },
                { status: 409, headers: { 'Cache-Control': 'no-store' } },
            );
        }
        return NextResponse.json({ data: { updatedAt: result.updatedAt } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to save settings.', 'SETTINGS_SAVE_FAILED');
    }
}
