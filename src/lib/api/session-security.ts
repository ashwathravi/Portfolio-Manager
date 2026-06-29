import { auth } from "@/auth";
import { isAuthConfigured } from "@/lib/auth/access";
import {
    apiError,
    authenticateApiRequest,
    rateLimitApiRequest,
    type ApiAuthContext,
} from "@/lib/api/security";

type ApiRequestLike = Parameters<typeof authenticateApiRequest>[0];

interface ScopedAuthSuccess {
    ok: true;
    context: ApiAuthContext & { userId: string };
}

interface AuthFailure {
    ok: false;
    response: Response;
}

export async function requireSessionApiUserScope(
    request: ApiRequestLike,
): Promise<ScopedAuthSuccess | AuthFailure> {
    const ipLimited = rateLimitApiRequest(request, { userId: null, authRequired: true });
    if (ipLimited) return { ok: false, response: ipLimited };

    const authConfigured = isAuthConfigured();
    if (authConfigured) {
        const session = await auth();
        if (session?.user?.id) {
            const userLimited = rateLimitApiRequest(
                request,
                { userId: session.user.id, authRequired: true },
                { skipIp: true },
            );
            if (userLimited) return { ok: false, response: userLimited };

            return {
                ok: true,
                context: {
                    userId: session.user.id,
                    authRequired: true,
                },
            };
        }

        if (!process.env.INTERNAL_API_SECRET?.trim()) {
            return {
                ok: false,
                response: apiError("Unauthorized", "UNAUTHORIZED", 401),
            };
        }
    }

    const internalAuth = authenticateApiRequest(request);
    if (!internalAuth.ok) return internalAuth;

    if (!internalAuth.context.userId) {
        return {
            ok: false,
            response: apiError("User scope is required.", "USER_SCOPE_REQUIRED", 401),
        };
    }

    const userLimited = rateLimitApiRequest(
        request,
        { userId: internalAuth.context.userId, authRequired: internalAuth.context.authRequired },
        { skipIp: true },
    );
    if (userLimited) return { ok: false, response: userLimited };

    return {
        ok: true,
        context: { ...internalAuth.context, userId: internalAuth.context.userId },
    };
}
