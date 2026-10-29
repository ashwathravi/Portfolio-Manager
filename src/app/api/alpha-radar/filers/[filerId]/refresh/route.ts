import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requestIdFrom } from '@/lib/observability/request-id';
import { requireAdminApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarRefreshService } from '@/lib/alpha-radar';
import { ALPHA_RADAR_BODY_MAX_BYTES, alphaRadarRefreshRequestSchema } from '@/lib/validators/alpha-radar';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const auth = await requireAdminApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const read = await readJsonBody(request, ALPHA_RADAR_BODY_MAX_BYTES);
        if (!read.ok && read.reason === 'too-large') {
            return apiError('Request is too large.', 'REQUEST_TOO_LARGE', 413);
        }
        // No body, or not JSON: a refresh with the defaults.
        const body = read.ok ? read.value : {};
        const parsed = alphaRadarRefreshRequestSchema.safeParse(body);
        if (!parsed.success) {
            return apiError(parsed.error.issues[0]?.message ?? 'Invalid refresh payload', 'INVALID_REFRESH_PAYLOAD', 400);
        }
        logApiEvent('alpha_radar_filer_refresh_requested', {
            route: '/api/alpha-radar/filers/[filerId]/refresh',
            requestId: requestIdFrom(request.headers),
            force: parsed.data.force === true,
            filingLimit: parsed.data.filingLimit,
            adminOnly: true,
        });
        const service = getAlphaRadarRefreshService();
        const result = await service.refreshFiler(filerId, {
            force: parsed.data.force === true,
            filingLimit: parsed.data.filingLimit,
        });
        if (result.totalFilers === 0) return apiError('Tracked filer not found', 'TRACKED_FILER_NOT_FOUND', 404);
        const status = result.errors.length > 0 ? 207 : 200;
        logApiEvent('alpha_radar_filer_refresh_completed', {
            route: '/api/alpha-radar/filers/[filerId]/refresh',
            requestId: requestIdFrom(request.headers),
            status,
            totalFilers: result.totalFilers,
            errorCount: result.errors.length,
            adminOnly: true,
        });
        return NextResponse.json({ data: result }, { status });
    } catch (error) {
        return internalServerError(error, 'Unable to refresh tracked filer.', 'ALPHA_RADAR_FILER_REFRESH_FAILED');
    }
}
