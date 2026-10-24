/**
 * GET /api/research/watchlist
 *
 * The signed-in user's watchlist (launch item i38), newest first, and the
 * example rows they removed.
 *
 * Response: { data: { items: WatchItem[], dismissed: string[] } }
 */

import { NextResponse } from 'next/server';

import { internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { loadWatchlist } from '@/lib/research/server/watchlist';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const data = await loadWatchlist(auth.context.userId);
        return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to load the watchlist.', 'WATCHLIST_LOAD_FAILED');
    }
}
