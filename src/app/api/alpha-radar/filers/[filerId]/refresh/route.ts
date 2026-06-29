import { NextRequest, NextResponse } from 'next/server';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { getAlphaRadarRefreshService } from '@/lib/alpha-radar';
import { alphaRadarRefreshRequestSchema } from '@/lib/validators/alpha-radar';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ filerId: string }> },
) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const { filerId } = await params;
    try {
        const body = await request.json().catch(() => ({}));
        const parsed = alphaRadarRefreshRequestSchema.safeParse(body);
        if (!parsed.success) {
            return apiError(parsed.error.issues[0]?.message ?? 'Invalid refresh payload', 'INVALID_REFRESH_PAYLOAD', 400);
        }
        logApiEvent('alpha_radar_filer_refresh_requested', {
            route: '/api/alpha-radar/filers/[filerId]/refresh',
            force: parsed.data.force === true,
            filingLimit: parsed.data.filingLimit,
            userScoped: true,
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
            status,
            totalFilers: result.totalFilers,
            errorCount: result.errors.length,
            userScoped: true,
        });
        return NextResponse.json({ data: result }, { status });
    } catch (error) {
        return internalServerError(error, 'Unable to refresh tracked filer.', 'ALPHA_RADAR_FILER_REFRESH_FAILED');
    }
}
