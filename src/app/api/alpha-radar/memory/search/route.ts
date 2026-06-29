import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { DrizzleAlphaRadarSemanticMemoryRepository } from '@/lib/alpha-radar';
import { alphaRadarMemorySearchQuerySchema } from '@/lib/validators/alpha-radar';

export async function GET(request: NextRequest) {
    try {
        const parsed = alphaRadarMemorySearchQuerySchema.safeParse({
            query: request.nextUrl.searchParams.get('query') ?? '',
            limit: request.nextUrl.searchParams.get('limit') ?? 5,
            trackedFilerId: request.nextUrl.searchParams.get('trackedFilerId') ?? undefined,
            reportPeriod: request.nextUrl.searchParams.get('reportPeriod') ?? undefined,
        });
        if (!parsed.success) {
            return apiError(parsed.error.issues[0]?.message ?? 'Invalid semantic search query', 'INVALID_ALPHA_RADAR_SEARCH', 400);
        }
        const { query, limit, trackedFilerId, reportPeriod } = parsed.data;

        if (!query.trim()) {
            return NextResponse.json({ data: { provider: 'keyword-fallback', matches: [] } });
        }

        const repository = new DrizzleAlphaRadarSemanticMemoryRepository();
        const result = await repository.search({
            query,
            limit,
            filters: {
                trackedFilerIds: trackedFilerId ? [trackedFilerId] : undefined,
                reportPeriods: reportPeriod ? [reportPeriod] : undefined,
            },
        });

        return NextResponse.json({ data: result });
    } catch (error) {
        return internalServerError(error, 'Unable to search Alpha Radar memory.', 'ALPHA_RADAR_MEMORY_SEARCH_FAILED');
    }
}
