export interface DashboardPortfoliosResult<T> {
    portfolios: T[];
    /**
     * True when a configured database failed to answer. Pages show an outage
     * notice instead of an empty portfolio, so an outage never looks like
     * "you have no accounts".
     */
    unavailable: boolean;
}

/**
 * Load the user's portfolios for a page. Without a configured database (local
 * runs with no DATABASE_URL) a failure degrades to an empty list; with one,
 * it is reported as unavailable.
 */
export async function loadDashboardPortfolios<T>(
    userId: string,
    query: (userId: string) => Promise<T[]>,
    { databaseConfigured = Boolean(process.env.DATABASE_URL?.trim()) }: { databaseConfigured?: boolean } = {},
): Promise<DashboardPortfoliosResult<T>> {
    try {
        return { portfolios: await query(userId), unavailable: false };
    } catch (error) {
        if (!databaseConfigured) {
            console.warn("Dashboard portfolio fetch failed without a configured database — showing empty state.", error);
            return { portfolios: [], unavailable: false };
        }
        console.error("Dashboard portfolio fetch failed — showing the outage notice.", error);
        return { portfolios: [], unavailable: true };
    }
}
