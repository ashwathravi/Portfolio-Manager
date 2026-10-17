export interface SchwabFeatureEnvironment {
    NODE_ENV?: string;
    SCHWAB_INTEGRATION_ENABLED?: string;
}

/**
 * The Schwab routes stay off unless SCHWAB_INTEGRATION_ENABLED=1, and never
 * run in production. They are not ready for real accounts: OAuth tokens are
 * discarded, the order route places orders with one global token, and stop,
 * IOC/FOK and option tickets map to the wrong Schwab order types.
 */
export function isSchwabIntegrationEnabled(env: SchwabFeatureEnvironment = process.env): boolean {
    return env.NODE_ENV !== "production" && env.SCHWAB_INTEGRATION_ENABLED?.trim() === "1";
}
