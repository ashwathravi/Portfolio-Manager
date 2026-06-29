import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { getAlphaRadarDataRepository } from '@/lib/alpha-radar';
import { alphaRadarReportPeriodSchema } from '@/lib/validators/alpha-radar';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const { filerId } = await params;
    try {
        const repository = getAlphaRadarDataRepository();
        const filer = await repository.getTrackedFiler(filerId);
        if (!filer) return NextResponse.json({ error: 'Tracked filer not found' }, { status: 404 });

        const explicitFilingId = request.nextUrl.searchParams.get('filingId');
        const rawReportPeriod = request.nextUrl.searchParams.get('reportPeriod') ?? undefined;
        const parsedReportPeriod = rawReportPeriod ? alphaRadarReportPeriodSchema.safeParse(rawReportPeriod) : undefined;
        if (parsedReportPeriod && !parsedReportPeriod.success) {
            return apiError(parsedReportPeriod.error.issues[0]?.message ?? 'Invalid report period', 'INVALID_REPORT_PERIOD', 400);
        }
        const filingId = explicitFilingId ?? (await resolveLatestFilingId(repository, filer.id, parsedReportPeriod?.data));
        if (!filingId) return NextResponse.json({ data: [] });

        const holdings = await repository.listHoldingsForFiling(filingId);
        return NextResponse.json({ data: holdings });
    } catch (error) {
        return internalServerError(error, 'Unable to list filing holdings.', 'ALPHA_RADAR_HOLDINGS_LIST_FAILED');
    }
}

async function resolveLatestFilingId(
    repository: ReturnType<typeof getAlphaRadarDataRepository>,
    trackedFilerId: string,
    reportPeriod: string | undefined,
): Promise<string | undefined> {
    const [filing] = await repository.listFilings({ trackedFilerId, reportPeriod, limit: 1 });
    return filing?.id;
}
