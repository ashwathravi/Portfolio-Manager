import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { alphaRadarListLimitSchema, alphaRadarReportPeriodSchema } from '@/lib/validators/alpha-radar';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
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
        const changes = await repository.listHoldingChanges({
            trackedFilerId: filer.id,
            reportPeriod: parsedReportPeriod?.data,
            limit: parsedLimit.data,
        });
        return NextResponse.json({ data: changes });
    } catch (error) {
        return internalServerError(error, 'Unable to list holding changes.', 'ALPHA_RADAR_CHANGES_LIST_FAILED');
    }
}
