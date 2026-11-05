/**
 * PUT    /api/alpha-radar/follows/[filerId]  follows a tracked filer
 * DELETE /api/alpha-radar/follows/[filerId]  stops following it
 *
 * Launch item i60. Both are idempotent and take no body. A filer that
 * doesn't exist is a 404 for PUT; DELETE answers the same either way.
 *
 * Responses: 200 { data: { filerId, following } }; 404 TRACKED_FILER_NOT_FOUND
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { followFiler, unfollowFiler } from '@/lib/alpha-radar/follows';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ filerId: string }> };

const notFound = () => apiError('Tracked filer not found', 'TRACKED_FILER_NOT_FOUND', 404);

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { filerId } = await params;
    if (!idSchema.safeParse(filerId).success) return notFound();

    try {
        const followed = await followFiler(auth.context.userId, filerId);
        return followed ? NextResponse.json({ data: { filerId, following: true } }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to follow the filer.', 'ALPHA_RADAR_FOLLOW_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { filerId } = await params;
    if (!idSchema.safeParse(filerId).success) return notFound();

    try {
        await unfollowFiler(auth.context.userId, filerId);
        return NextResponse.json({ data: { filerId, following: false } });
    } catch (err) {
        return internalServerError(err, 'Unable to stop following the filer.', 'ALPHA_RADAR_UNFOLLOW_FAILED');
    }
}
