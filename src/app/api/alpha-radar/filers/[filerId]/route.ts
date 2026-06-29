import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { alphaRadarTrackedFilerSchema } from '@/lib/validators/alpha-radar';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const { filerId } = await params;
    try {
        const repository = getAlphaRadarDataRepository();
        const filer = await repository.getTrackedFiler(filerId);
        if (!filer) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });
        return NextResponse.json({ data: filer });
    } catch (error) {
        return internalServerError(error, 'Unable to load tracked filer.', 'ALPHA_RADAR_FILER_LOAD_FAILED');
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const existing = await getAlphaRadarDataRepository().getTrackedFiler(filerId);
        if (!existing) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });

        const body = await request.json();
        const parsed = alphaRadarTrackedFilerSchema.partial().safeParse({ ...existing, ...body });
        if (!parsed.success) {
            return apiError(parsed.error.issues[0]?.message ?? 'Invalid tracked filer payload', 'INVALID_TRACKED_FILER', 400);
        }

        const repository = getAlphaRadarDataRepository();
        const filer = await repository.updateTrackedFiler(filerId, parsed.data);
        return NextResponse.json({ data: filer });
    } catch (error) {
        return internalServerError(error, 'Unable to update tracked filer.', 'ALPHA_RADAR_FILER_UPDATE_FAILED');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const repository = getAlphaRadarDataRepository();
        const filer = await repository.disableTrackedFiler(filerId);
        if (!filer) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });
        return NextResponse.json({ data: filer });
    } catch (error) {
        return internalServerError(error, 'Unable to disable tracked filer.', 'ALPHA_RADAR_FILER_DISABLE_FAILED');
    }
}
