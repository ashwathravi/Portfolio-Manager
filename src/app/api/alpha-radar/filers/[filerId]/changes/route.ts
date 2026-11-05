import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { applyAlphaRadarUserOverlap, loadAlphaRadarUserOverlap } from '@/lib/alpha-radar/user-overlap';
import { alphaRadarListLimitSchema, alphaRadarReportPeriodSchema } from '@/lib/validators/alpha-radar';

export const dynamic = 'force-dynamic';

/**
 * A filer's 13F changes, each with where it meets the signed-in user: what
 * they hold, watch or have an active thesis on (launch item i61), and
 * ranked with it.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const repository = getAlphaRadarDataRepository();
        const filer = await repository.getTrackedFiler(filerId);
        if (!filer) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });
        const rawReportPeriod = request.nextUrl.searchParams.get('reportPeriod') ?? undefined;
        const parsedReportPeriod = rawReportPeriod ? alphaRadarReportPeriodSchema.safeParse(rawReportPeriod) : undefined;
        if (parsedReportPeriod && !parsedReportPeriod.success) {
            return apiError(parsedReportPeriod.error.issues[0]?.message ?? 'Invalid report period', 'INVALID_REPORT_PERIOD', 400);
        }
        const parsedLimit = alphaRadarListLimitSchema.safeParse(request.nextUrl.searchParams.get('limit') ?? 100);
        if (!parsedLimit.success) {
            return apiError(parsedLimit.error.issues[0]?.message ?? 'Invalid limit', 'INVALID_LIMIT', 400);
        }
        const [changes, overlap] = await Promise.all([
            repository.listHoldingChanges({
                trackedFilerId: filer.id,
                reportPeriod: parsedReportPeriod?.data,
                limit: parsedLimit.data,
            }),
            loadAlphaRadarUserOverlap(auth.context.userId),
        ]);
        return NextResponse.json(
            { data: applyAlphaRadarUserOverlap(changes, overlap) },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return internalServerError(error, 'Unable to list holding changes.', 'ALPHA_RADAR_CHANGES_LIST_FAILED');
    }
}
