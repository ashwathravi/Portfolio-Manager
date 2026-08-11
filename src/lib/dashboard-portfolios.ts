/**
 * Load dashboard portfolio data without making the dashboard unavailable when
 * persistence is not configured or temporarily unreachable.
 */
export async function loadDashboardPortfolios<T>(query: () => Promise<T[]>): Promise<T[]> {
    try {
        return await query();
    } catch (error) {
        console.warn("Dashboard portfolio fetch failed — showing empty state.", error);
        return [];
    }
}
