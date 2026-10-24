/**
 * PUT /api/research/theses/[id]  saves one thesis (adds, replaces or deletes it)
 *
 * Launch item i38. The thesis comes whole, with its catalysts and evidence,
 * which replace the ones stored. Deleting is a save with `dismissed: true`:
 * an example stays hidden, and the user's own thesis is kept with its text
 * cleared, so a save that arrives late can't bring it back. A write older
 * than one the thesis already has from the same page is ignored.
 *
 * Body: { thesis: Thesis (its id must match the path), order: { session, seq } }
 * Responses: 204; 400 INVALID_THESIS; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { saveThesis } from '@/lib/research/server/theses';
import { THESIS_PUT_MAX_BYTES, thesisPutSchema } from '@/lib/validators/thesis';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const body = await readJsonBody(request, THESIS_PUT_MAX_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Thesis is too large.', 'THESIS_TOO_LARGE', 413)
            : apiError('Invalid thesis', 'INVALID_THESIS', 400);
    }
    const parsed = thesisPutSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid thesis', 'INVALID_THESIS', 400);
    }
    if (parsed.data.thesis.id !== id) return apiError('The thesis id must match the path', 'INVALID_THESIS', 400);

    try {
        await saveThesis(auth.context.userId, parsed.data.thesis, parsed.data.order);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return internalServerError(err, 'Unable to save the thesis.', 'THESIS_SAVE_FAILED');
    }
}
