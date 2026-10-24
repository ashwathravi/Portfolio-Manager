/**
 * GET /api/research/journal
 *
 * The signed-in user's decision journal (launch item i38), newest first, and
 * the example entries they deleted.
 *
 * Response: { data: { entries: JournalEntry[], dismissed: string[] } }
 */

import { NextResponse } from 'next/server';

import { internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { loadJournal } from '@/lib/research/server/journal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const data = await loadJournal(auth.context.userId);
        return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return internalServerError(err, 'Unable to load the journal.', 'JOURNAL_LOAD_FAILED');
    }
}
