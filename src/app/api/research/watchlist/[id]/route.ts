/**
 * PUT /api/research/watchlist/[id]  saves one item (adds, replaces or removes it)
 *
 * Launch item i38. Removing an item is a save with `dismissed: true`: an
 * example stays hidden, and the user's own row is kept with its text cleared,
 * so a save that arrives late can't bring it back.
 *
 * Body: { item: WatchItem (its id must match the path), order: { session, seq } }
 *
 * `order` names the page that sent the write and its count of writes: a
 * write older than one the row already has from that page is ignored, so a
 * request that arrives late can't undo a later edit.
 *
 * Responses: 204; 400 INVALID_WATCH_ITEM; 409 DUPLICATE_TICKER; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { DuplicateTickerError, saveWatchItem } from '@/lib/research/server/watchlist';
import { WATCH_ITEM_PUT_MAX_BYTES, watchItemPutSchema } from '@/lib/validators/watchlist';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const body = await readJsonBody(request, WATCH_ITEM_PUT_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Watchlist item is too large.', 'WATCH_ITEM_TOO_LARGE', 413)
            : apiError('Invalid watchlist item', 'INVALID_WATCH_ITEM', 400);
    }
    const parsed = watchItemPutSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid watchlist item', 'INVALID_WATCH_ITEM', 400);
    }
    if (parsed.data.item.id !== id) return apiError('The item id must match the path', 'INVALID_WATCH_ITEM', 400);

    try {
        await saveWatchItem(auth.context.userId, parsed.data.item, parsed.data.order);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        if (err instanceof DuplicateTickerError) {
            return apiError(`${err.ticker} is already on your watchlist.`, 'DUPLICATE_TICKER', 409);
        }
        return internalServerError(err, 'Unable to save the watchlist item.', 'WATCH_ITEM_SAVE_FAILED');
    }
}
