/**
 * The alert_rules table (launch item i57). Every query is scoped to one
 * user's ID, which the API routes take from the session. Deleting a rule
 * deletes the notifications it raised (alert_notifications_rule_owner_fk).
 */

import { and, asc, count, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { alertRules } from "@/db/schema";
import { trackRequestedSecurities } from "@/lib/markets/price-store";
import { ALERT_RULES_PER_USER, type AlertRuleInput } from "@/lib/validators/alerts";

import { isAlphaRadarAlertMetric } from "../metrics";
import type { AlertRule } from "../types";

type Database = typeof db;
type AlertRuleRow = typeof alertRules.$inferSelect;

export function toAlertRule(row: AlertRuleRow): AlertRule {
    const metric = row.metric as AlertRule["metric"];
    return {
        id: row.id,
        name: row.name,
        metric,
        ...(row.symbol ? { symbol: row.symbol } : {}),
        comparator: row.comparator as AlertRule["comparator"],
        threshold: row.threshold,
        enabled: row.enabled,
        rearm: row.rearm as AlertRule["rearm"],
        ...(row.note ? { note: row.note } : {}),
        source: isAlphaRadarAlertMetric(metric) ? "alpha_radar" : "market",
        createdAt: row.createdAt.toISOString(),
        ...(row.lastTriggeredAt ? { lastTriggeredAt: row.lastTriggeredAt.toISOString() } : {}),
    };
}

export function buildListAlertRulesQuery(userId: string, database: Database = db) {
    return database
        .select()
        .from(alertRules)
        .where(eq(alertRules.userId, userId))
        .orderBy(asc(alertRules.createdAt), asc(alertRules.id));
}

export async function listAlertRules(userId: string, database: Database = db): Promise<AlertRule[]> {
    return (await buildListAlertRulesQuery(userId, database)).map(toAlertRule);
}

export class AlertRuleLimitError extends Error {
    constructor() {
        super(`An account can have at most ${ALERT_RULES_PER_USER} alert rules`);
    }
}

/**
 * The nightly price job prices only symbols it tracks; a rule's symbol is
 * asked for like a quote lookup's, within the same room.
 */
async function trackRuleSymbol(input: AlertRuleInput, database: Database): Promise<void> {
    if (!input.symbol) return;
    try {
        await trackRequestedSecurities([input.symbol], undefined, database);
    } catch (error) {
        // The rule still saves; the symbol is asked for again when it's next saved.
        console.warn("Alert rule saved, but tracking its symbol failed.", error);
    }
}

/** Serializes one user's creates, so two at once can't both pass the limit. */
const userRulesLock = (userId: string) => sql`select pg_advisory_xact_lock(hashtext(${`atlas:alert-rules:${userId}`}))`;

export async function createAlertRule(
    userId: string,
    input: AlertRuleInput,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<AlertRule> {
    const row = await database.transaction(async (tx) => {
        await tx.execute(userRulesLock(userId));
        const [{ value: existing }] = await tx.select({ value: count() }).from(alertRules).where(eq(alertRules.userId, userId));
        if (existing >= ALERT_RULES_PER_USER) throw new AlertRuleLimitError();
        const [created] = await tx
            .insert(alertRules)
            .values({ userId, ...input, createdAt: now, updatedAt: now })
            .returning();
        return created;
    });
    await trackRuleSymbol(input, database);
    return toAlertRule(row);
}

/** Replaces the user's rule; null when they have no rule with that ID. */
export async function updateAlertRule(
    userId: string,
    id: string,
    input: AlertRuleInput,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<AlertRule | null> {
    const [row] = await database
        .update(alertRules)
        .set({ ...input, updatedAt: now })
        .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
        .returning();
    if (!row) return null;
    await trackRuleSymbol(input, database);
    return toAlertRule(row);
}

/** Deletes the user's rule and what it raised; false when they have no rule with that ID. */
export async function deleteAlertRule(userId: string, id: string, database: Database = db): Promise<boolean> {
    const deleted = await database
        .delete(alertRules)
        .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
        .returning({ id: alertRules.id });
    return deleted.length > 0;
}
