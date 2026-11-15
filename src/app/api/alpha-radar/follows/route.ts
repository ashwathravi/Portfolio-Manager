/**
 * GET /api/alpha-radar/follows
 *
 * The tracked filers the signed-in user follows (launch item i60), by name.
 *
 * Response: { data: { filerIds: string[] } }
 */

import { NextResponse } from 'next/server';

import { listFollowedFilerIds } from '@/lib/alpha-radar/follows';
import { internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const filerIds = await listFollowedFilerIds(auth.context.userId);
        return NextResponse.json({ data: { filerIds } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to load the filers you follow.', 'ALPHA_RADAR_FOLLOWS_LOAD_FAILED');
    }
}
