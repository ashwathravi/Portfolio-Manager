/**
 * PUT /api/research/journal/[id]  saves one entry (adds, replaces or deletes it)
 *
 * Launch item i38. Deleting an entry is a save with `dismissed: true`: an
 * example stays hidden, and the user's own entry is kept with its text
 * cleared, so a save that arrives late can't bring it back.
 *
 * Body: { entry: JournalEntry (its id must match the path), order: { session, seq } }
 *
 * As for the watchlist, a write older than one the entry already has from
 * the same page is ignored.
 *
 * Responses: 204; 400 INVALID_JOURNAL_ENTRY; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { saveJournalEntry } from '@/lib/research/server/journal';
import { JOURNAL_ENTRY_PUT_MAX_BYTES, journalEntryPutSchema } from '@/lib/validators/journal';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const body = await readJsonBody(request, JOURNAL_ENTRY_PUT_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Journal entry is too large.', 'JOURNAL_ENTRY_TOO_LARGE', 413)
            : apiError('Invalid journal entry', 'INVALID_JOURNAL_ENTRY', 400);
    }
    const parsed = journalEntryPutSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid journal entry', 'INVALID_JOURNAL_ENTRY', 400);
    }
    if (parsed.data.entry.id !== id) return apiError('The entry id must match the path', 'INVALID_JOURNAL_ENTRY', 400);

    try {
        await saveJournalEntry(auth.context.userId, parsed.data.entry, parsed.data.order);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to save the journal entry.', 'JOURNAL_ENTRY_SAVE_FAILED');
    }
}
