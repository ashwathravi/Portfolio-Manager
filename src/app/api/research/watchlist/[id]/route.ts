/**
 * PUT    /api/research/watchlist/[id]  saves one item (adds or replaces it)
 * DELETE /api/research/watchlist/[id]  removes one
 *
 * Launch item i38. An example row the user removes is saved with
 * `dismissed: true` rather than deleted, so it isn't shown again.
 *
 * PUT body: WatchItem (its id must match the path)
 * Responses: 204; 400 INVALID_WATCH_ITEM; 409 DUPLICATE_TICKER
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { DuplicateTickerError, deleteWatchItem, saveWatchItem } from '@/lib/research/server/watchlist';
import { watchItemSchema } from '@/lib/validators/watchlist';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Watchlist item is too large.', 'WATCH_ITEM_TOO_LARGE', 413)
            : apiError('Invalid watchlist item', 'INVALID_WATCH_ITEM', 400);
    }
    const parsed = watchItemSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid watchlist item', 'INVALID_WATCH_ITEM', 400);
    }
    if (parsed.data.id !== id) return apiError('The item id must match the path', 'INVALID_WATCH_ITEM', 400);

    try {
        await saveWatchItem(auth.context.userId, parsed.data);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        if (err instanceof DuplicateTickerError) {
            return apiError(`${err.ticker} is already on your watchlist.`, 'DUPLICATE_TICKER', 409);
        }
        return internalServerError(err, 'Unable to save the watchlist item.', 'WATCH_ITEM_SAVE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    try {
        await deleteWatchItem(auth.context.userId, id);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to remove the watchlist item.', 'WATCH_ITEM_DELETE_FAILED');
    }
}
