import type { Session } from "next-auth";

import { auth } from "@/auth";
import {
    authRuntimeMode,
    getLocalDevUserId,
    type AuthEnvironment,
} from "@/lib/auth/access";
import {
    apiError,
    rateLimitApiRequest,
    type ApiAuthContext,
} from "@/lib/api/security";

type ApiRequestLike = Parameters<typeof rateLimitApiRequest>[0];

interface ScopedAuthSuccess {
    ok: true;
    context: ApiAuthContext & { userId: string };
}

interface AuthFailure {
    ok: false;
    response: Response;
}

interface SessionScopeOptions {
    env?: AuthEnvironment;
    getSession?: () => Promise<Session | null>;
}

/**
 * The user for a session-backed API route: the Auth.js session user, or the
 * fixed local-dev principal in explicit non-production bypass mode. Nothing
 * else names a user: no header, and no shared secret.
 */
export async function requireSessionApiUserScope(
    request: ApiRequestLike,
    {
        env = process.env,
        getSession = auth,
    }: SessionScopeOptions = {},
): Promise<ScopedAuthSuccess | AuthFailure> {
    const ipLimited = rateLimitApiRequest(request, { userId: null, authRequired: true });
    if (ipLimited) return { ok: false, response: ipLimited };

    const mode = authRuntimeMode(env);
    if (mode === "local-bypass") {
        return authorizeUser(request, getLocalDevUserId(env), true);
    }

    if (mode === "configured") {
        const session = await getSession();
        if (session?.user?.id) {
            return authorizeUser(request, session.user.id, true);
        }

        return {
            ok: false,
            response: apiError("Unauthorized", "UNAUTHORIZED", 401),
        };
    }

    return {
        ok: false,
        response: apiError(
            "Authentication is not configured.",
            "AUTH_CONFIGURATION_ERROR",
            503,
        ),
    };
}

function authorizeUser(
    request: ApiRequestLike,
    userId: string | null,
    authRequired: boolean,
): ScopedAuthSuccess | AuthFailure {
    if (!userId) {
        return {
            ok: false,
            response: apiError("User scope is required.", "USER_SCOPE_REQUIRED", 401),
        };
    }

    const userLimited = rateLimitApiRequest(
        request,
        { userId, authRequired },
        { skipIp: true },
    );
    if (userLimited) return { ok: false, response: userLimited };

    return {
        ok: true,
        context: { userId, authRequired },
    };
}
