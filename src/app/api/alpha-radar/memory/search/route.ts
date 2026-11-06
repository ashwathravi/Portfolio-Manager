import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError } from '@/lib/api/security';
import { DrizzleAlphaRadarSemanticMemoryRepository } from '@/lib/alpha-radar';
import { embedAlphaRadarQuery } from '@/lib/alpha-radar/embeddings';
import { searchAlphaRadarMemoryChunks } from '@/lib/alpha-radar/memory';
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

        const chunks = await new DrizzleAlphaRadarSemanticMemoryRepository().listChunks({
            trackedFilerIds: trackedFilerId ? [trackedFilerId] : undefined,
            reportPeriods: reportPeriod ? [reportPeriod] : undefined,
        });
        // By meaning as well as words when the chunks were embedded (launch item i62).
        const result = searchAlphaRadarMemoryChunks({ query, limit, chunks, ...await embedAlphaRadarQuery(query, chunks) });

        return NextResponse.json({ data: result });
    } catch (error) {
        return internalServerError(error, 'Unable to search Alpha Radar memory.', 'ALPHA_RADAR_MEMORY_SEARCH_FAILED');
    }
}
