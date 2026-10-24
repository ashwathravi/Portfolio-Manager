/**
 * POST /api/research/theses/import
 *
 * The one-time move of this browser's theses into the user's account
 * (launch item i38), with their catalysts and evidence. Theses the account
 * already has are left as they are, so it is safe to send again.
 *
 * Body: { items: Thesis[], first?: number, startedAt?: number } (many theses
 * come in batches; see thesisImportSchema)
 * Responses: 204; 400 INVALID_THESIS_IMPORT; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { importTheses } from '@/lib/research/server/theses';
import { THESIS_PUT_MAX_BYTES, thesisImportSchema } from '@/lib/validators/thesis';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    // A batch holds at least one thesis, so it may be as big as one.
    const body = await readJsonBody(request, THESIS_PUT_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Thesis import is too large.', 'THESIS_IMPORT_TOO_LARGE', 413)
            : apiError('Invalid thesis import', 'INVALID_THESIS_IMPORT', 400);
    }
    const parsed = thesisImportSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid thesis import', 'INVALID_THESIS_IMPORT', 400);
    }

    try {
        await importTheses(auth.context.userId, parsed.data);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to import your theses.', 'THESIS_IMPORT_FAILED');
    }
}
