import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireAdminApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { ALPHA_RADAR_BODY_MAX_BYTES, alphaRadarTrackedFilerSchema } from '@/lib/validators/alpha-radar';

export async function GET() {
    try {
        const repository = getAlphaRadarDataRepository();
        const filers = await repository.listTrackedFilers();
        return NextResponse.json({ data: filers });
    } catch (error) {
        return internalServerError(error, 'Unable to list tracked filers.', 'ALPHA_RADAR_FILERS_LIST_FAILED');
    }
}

export async function POST(request: NextRequest) {
    const auth = await requireAdminApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const read = await readJsonBody(request, ALPHA_RADAR_BODY_MAX_BYTES);
        if (!read.ok && read.reason === 'too-large') {
            return apiError('Request is too large.', 'REQUEST_TOO_LARGE', 413);
        }
        if (!read.ok) return apiError('Invalid tracked filer payload', 'INVALID_TRACKED_FILER', 400);
        const parsed = alphaRadarTrackedFilerSchema.safeParse(read.value);
        if (!parsed.success) {
            return apiError(parsed.error.issues[0]?.message ?? 'Invalid tracked filer payload', 'INVALID_TRACKED_FILER', 400);
        }

        const repository = getAlphaRadarDataRepository();
        const filer = await repository.createTrackedFiler(parsed.data);
        return NextResponse.json({ data: filer }, { status: 201 });
    } catch (error) {
        return internalServerError(error, 'Unable to create tracked filer.', 'ALPHA_RADAR_FILER_CREATE_FAILED');
    }
}
