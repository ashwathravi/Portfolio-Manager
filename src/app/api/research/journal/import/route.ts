/**
 * POST /api/research/journal/import
 *
 * The one-time move of this browser's decision journal into the user's
 * account (launch item i38). Entries the account already has are left as
 * they are, so it is safe to send again.
 *
 * Body: { items: JournalEntry[], first?: number, startedAt?: number } (a big
 * journal comes in batches; see journalImportSchema)
 * Responses: 204; 400 INVALID_JOURNAL_IMPORT; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { importJournal } from '@/lib/research/server/journal';
import { journalImportSchema } from '@/lib/validators/journal';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Journal import is too large.', 'JOURNAL_IMPORT_TOO_LARGE', 413)
            : apiError('Invalid journal import', 'INVALID_JOURNAL_IMPORT', 400);
    }
    const parsed = journalImportSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid journal import', 'INVALID_JOURNAL_IMPORT', 400);
    }

    try {
        await importJournal(auth.context.userId, parsed.data);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to import the journal.', 'JOURNAL_IMPORT_FAILED');
    }
}
