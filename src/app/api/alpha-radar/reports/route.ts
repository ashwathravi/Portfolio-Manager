import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import {
    alphaRadarListLimitSchema,
    alphaRadarReportPeriodSchema,
    alphaRadarTrackedFilerIdsSchema,
} from '@/lib/validators/alpha-radar';

export async function GET(request: NextRequest) {
    try {
        const repository = getAlphaRadarDataRepository();
        const trackedFilerId = request.nextUrl.searchParams.get('trackedFilerId') ?? undefined;
        // Several filers at once (the ones a user follows), limited together:
        // filtering the latest reports of every filer would lose theirs.
        const rawTrackedFilerIds = request.nextUrl.searchParams.get('trackedFilerIds');
        const parsedTrackedFilerIds = rawTrackedFilerIds === null ? undefined : alphaRadarTrackedFilerIdsSchema.safeParse(rawTrackedFilerIds);
        if (parsedTrackedFilerIds && !parsedTrackedFilerIds.success) {
            return apiError(parsedTrackedFilerIds.error.issues[0]?.message ?? 'Invalid filer IDs', 'INVALID_TRACKED_FILER_IDS', 400);
        }
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
            trackedFilerIds: parsedTrackedFilerIds?.data,
            reportPeriod: parsedReportPeriod?.data,
            limit: parsedLimit.data,
        });
        return NextResponse.json({ data: reports });
    } catch (error) {
        return internalServerError(error, 'Unable to list Alpha Radar reports.', 'ALPHA_RADAR_REPORTS_LIST_FAILED');
    }
}
