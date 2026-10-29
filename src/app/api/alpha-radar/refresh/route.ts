import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requestIdFrom } from '@/lib/observability/request-id';
import { requireAdminApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarRefreshService } from '@/lib/alpha-radar';
import { ALPHA_RADAR_BODY_MAX_BYTES, alphaRadarRefreshRequestSchema } from '@/lib/validators/alpha-radar';

export async function POST(request: NextRequest) {
    const auth = await requireAdminApiUserScope(request);
    if (!auth.ok) return auth.response;

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
        logApiEvent('alpha_radar_refresh_requested', {
            route: '/api/alpha-radar/refresh',
            requestId: requestIdFrom(request.headers),
            force: parsed.data.force === true,
            filingLimit: parsed.data.filingLimit,
            adminOnly: true,
        });
        const service = getAlphaRadarRefreshService();
        const result = await service.refreshAll({
            force: parsed.data.force === true,
            filingLimit: parsed.data.filingLimit,
        });
        const status = result.errors.length > 0 ? 207 : 200;
        logApiEvent('alpha_radar_refresh_completed', {
            route: '/api/alpha-radar/refresh',
            requestId: requestIdFrom(request.headers),
            status,
            totalFilers: result.totalFilers,
            errorCount: result.errors.length,
            adminOnly: true,
        });
        return NextResponse.json({ data: result }, { status });
    } catch (error) {
        return internalServerError(error, 'Unable to refresh Alpha Radar.', 'ALPHA_RADAR_REFRESH_FAILED');
    }
}
