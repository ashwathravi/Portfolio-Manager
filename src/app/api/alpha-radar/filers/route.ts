import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { alphaRadarTrackedFilerSchema } from '@/lib/validators/alpha-radar';

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
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json();
        const parsed = alphaRadarTrackedFilerSchema.safeParse(body);
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
