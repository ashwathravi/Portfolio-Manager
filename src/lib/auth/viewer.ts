import type { Session } from "next-auth";

import { auth } from "@/auth";
import { authRuntimeMode, getLocalDevUserId, type AuthEnvironment } from "@/lib/auth/access";
import type { ViewerIdentity } from "@/lib/identity";

/**
 * Resolves the viewer's display identity for the app chrome. Never throws:
 * a missing or misconfigured session simply yields `null`, and pages keep
 * enforcing access through requirePageUserId / the proxy.
 */
export async function resolveViewerIdentity({
    env = process.env,
    getSession = auth,
}: { env?: AuthEnvironment; getSession?: () => Promise<Session | null> } = {}): Promise<ViewerIdentity | null> {
    const mode = authRuntimeMode(env);
    if (mode === "invalid") return null;
    if (mode === "local-bypass") {
        return { id: getLocalDevUserId(env), name: null, email: null, image: null, mode: "local-dev" };
    }
    try {
        const session = await getSession();
        const user = session?.user;
        if (!user) return null;
        return {
            id: user.id?.trim() || null,
            name: user.name?.trim() || null,
            email: user.email?.trim() || null,
            image: user.image?.trim() || null,
            mode: "signed-in",
        };
    } catch {
        return null;
    }
}
