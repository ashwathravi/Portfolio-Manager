/**
 * POST /api/research/watchlist/import
 *
 * The one-time move of this browser's watchlist into the user's account
 * (launch item i38). Items the account already has are left as they are,
 * so it is safe to send again.
 *
 * Body: { items: WatchItem[] }
 * Responses: 204; 400 INVALID_WATCHLIST_IMPORT
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { importWatchlist } from '@/lib/research/server/watchlist';
import { watchlistImportSchema } from '@/lib/validators/watchlist';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Watchlist import is too large.', 'WATCHLIST_IMPORT_TOO_LARGE', 413)
            : apiError('Invalid watchlist import', 'INVALID_WATCHLIST_IMPORT', 400);
    }
    const parsed = watchlistImportSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid watchlist import', 'INVALID_WATCHLIST_IMPORT', 400);
    }

    try {
        await importWatchlist(auth.context.userId, parsed.data.items);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to import the watchlist.', 'WATCHLIST_IMPORT_FAILED');
    }
}
