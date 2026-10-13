export type DatabaseReadiness = "ok" | "not_configured" | "unavailable";

export interface ReadinessResult {
    status: "ok" | "degraded";
    database: DatabaseReadiness;
    checkedAt: string;
}

export interface ReadinessCheckOptions {
    /** Whether a database connection is configured at all. */
    isConfigured: () => boolean;
    /** Runs a trivial query; rejects when the database can't answer. */
    ping: () => Promise<unknown>;
    /** How long a ping may take before it counts as unavailable. */
    timeoutMs?: number;
    /** How long a result is reused, so a public endpoint can't hammer the database. */
    cacheMs?: number;
    now?: () => number;
}

/**
 * A readiness check for /api/health/ready. Results are cached briefly and
 * concurrent callers share one ping. It reports only coarse states, never
 * error details, because the endpoint is public.
 */
export function createReadinessCheck({
    isConfigured,
    ping,
    timeoutMs = 3_000,
    cacheMs = 10_000,
    now = Date.now,
}: ReadinessCheckOptions): () => Promise<ReadinessResult> {
    let cached: { result: ReadinessResult; expiresAt: number } | null = null;
    let inFlight: Promise<ReadinessResult> | null = null;

    async function check(): Promise<ReadinessResult> {
        const database = isConfigured() ? await pingWithTimeout(ping, timeoutMs) : "not_configured";
        return {
            status: database === "ok" ? "ok" : "degraded",
            database,
            checkedAt: new Date(now()).toISOString(),
        };
    }

    return async () => {
        if (cached && now() < cached.expiresAt) return cached.result;
        if (inFlight) return inFlight;

        inFlight = check()
            .then((result) => {
                cached = { result, expiresAt: now() + cacheMs };
                return result;
            })
            .finally(() => {
                inFlight = null;
            });
        return inFlight;
    };
}

async function pingWithTimeout(ping: () => Promise<unknown>, timeoutMs: number): Promise<DatabaseReadiness> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"unavailable">((resolve) => {
        timer = setTimeout(() => resolve("unavailable"), timeoutMs);
    });
    try {
        return await Promise.race([
            ping().then((): DatabaseReadiness => "ok", (): DatabaseReadiness => "unavailable"),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}
