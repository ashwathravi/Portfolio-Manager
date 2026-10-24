/**
 * GET /api/research/theses
 *
 * The signed-in user's theses with their catalysts and evidence (launch
 * item i38), newest first, and the theses they deleted.
 *
 * Response: { data: { theses: Thesis[], dismissed: string[] } }
 */

import { NextResponse } from 'next/server';

import { internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { loadTheses } from '@/lib/research/server/theses';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const data = await loadTheses(auth.context.userId);
        return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to load your theses.', 'THESES_LOAD_FAILED');
    }
}
