import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { alphaRadarListLimitSchema, alphaRadarReportPeriodSchema } from '@/lib/validators/alpha-radar';

export async function GET(request: NextRequest) {
    try {
        const repository = getAlphaRadarDataRepository();
        const trackedFilerId = request.nextUrl.searchParams.get('trackedFilerId') ?? undefined;
        const rawReportPeriod = request.nextUrl.searchParams.get('reportPeriod') ?? undefined;
        const parsedReportPeriod = rawReportPeriod ? alphaRadarReportPeriodSchema.safeParse(rawReportPeriod) : undefined;
        if (parsedReportPeriod && !parsedReportPeriod.success) {
            return apiError(parsedReportPeriod.error.issues[0]?.message ?? 'Invalid report period', 'INVALID_REPORT_PERIOD', 400);
        }
        const parsedLimit = alphaRadarListLimitSchema.safeParse(request.nextUrl.searchParams.get('limit') ?? 20);
        if (!parsedLimit.success) {
            return apiError(parsedLimit.error.issues[0]?.message ?? 'Invalid limit', 'INVALID_LIMIT', 400);
        }
        const reports = await repository.listReports({
            trackedFilerId,
            reportPeriod: parsedReportPeriod?.data,
            limit: parsedLimit.data,
        });
        return NextResponse.json({ data: reports });
    } catch (error) {
        return internalServerError(error, 'Unable to list Alpha Radar reports.', 'ALPHA_RADAR_REPORTS_LIST_FAILED');
    }
}
