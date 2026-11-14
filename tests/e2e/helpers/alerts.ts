import { e2eDatabase } from './users';

/**
 * Adds a notification to a user's alert feed, as the nightly alerts job
 * would (launch item i57; the job itself is tested in scripts/db/alerts.test.ts).
 */
export async function raiseAlert(userId: string, ruleId: string, alert: {
    occurrence: string;
    message: string;
    triggeredAt: string;
    symbol?: string;
}): Promise<void> {
    const sql = e2eDatabase();
    await sql`
        INSERT INTO alert_notifications (user_id, rule_id, occurrence, rule_name, metric, symbol, comparator, threshold, observed_value, message, href, triggered_at)
        SELECT ${userId}, id, ${alert.occurrence}, name, metric, ${alert.symbol ?? null}, comparator, threshold, threshold, ${alert.message},
               ${alert.symbol ? `/portfolios/detail/${alert.symbol}` : '/portfolios/holdings'}, ${alert.triggeredAt}
        FROM alert_rules WHERE id = ${ruleId} AND user_id = ${userId}`;
}
