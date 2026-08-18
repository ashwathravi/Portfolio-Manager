import type { Session } from "next-auth";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
    authRuntimeMode,
    getLocalDevUserId,
    type AuthEnvironment,
} from "@/lib/auth/access";

export class AuthConfigurationError extends Error {
    constructor() {
        super("Authentication is not configured.");
        this.name = "AuthConfigurationError";
    }
}

interface ResolveRequestUserOptions {
    env?: AuthEnvironment;
    getSession?: () => Promise<Session | null>;
}

export async function resolveRequestUserId({
    env = process.env,
    getSession = auth,
}: ResolveRequestUserOptions = {}): Promise<string | null> {
    const mode = authRuntimeMode(env);
    if (mode === "invalid") throw new AuthConfigurationError();
    if (mode === "local-bypass") return getLocalDevUserId(env);

    const session = await getSession();
    return session?.user?.id?.trim() || null;
}

export async function requirePageUserId(): Promise<string> {
    const userId = await resolveRequestUserId();
    if (!userId) redirect("/login");
    return userId;
}
