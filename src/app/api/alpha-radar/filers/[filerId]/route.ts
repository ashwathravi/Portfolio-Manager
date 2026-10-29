import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireAdminApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { ALPHA_RADAR_BODY_MAX_BYTES, alphaRadarTrackedFilerSchema } from '@/lib/validators/alpha-radar';

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
    const auth = await requireAdminApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const existing = await getAlphaRadarDataRepository().getTrackedFiler(filerId);
        if (!existing) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });

        const read = await readJsonBody(request, ALPHA_RADAR_BODY_MAX_BYTES);
        if (!read.ok && read.reason === 'too-large') {
            return apiError('Request is too large.', 'REQUEST_TOO_LARGE', 413);
        }
        if (!read.ok) return apiError('Invalid tracked filer payload', 'INVALID_TRACKED_FILER', 400);
        const body = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? read.value : {};
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
    const auth = await requireAdminApiUserScope(request);
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
