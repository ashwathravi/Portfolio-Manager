/**
 * Nightly job "alerts" (launch item i57): evaluates every enabled alert
 * rule after the day's closes and valuation snapshots are stored, and adds
 * what they raise to each user's notification feed. The rules themselves
 * are in ./nightly-plan.ts; this reads what they need and writes the result.
 *
 * A notification is inserted once per rule and occurrence
 * (alert_notifications_rule_occurrence_idx), so running the job again the
 * same evening adds nothing. A rule set to fire once is paused when it
 * does. Notifications older than NOTIFICATION_RETENTION_DAYS are deleted.
 */

import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
    alertNotifications,
    alertRules,
    alphaRadarHoldingChanges,
    alphaRadarTrackedFilers,
    holdings,
    jobRuns,
    portfolios,
    theses,
    userSettings,
    watchlistItems,
} from "@/db/schema";
import { buildRecentClosesQuery, getLatestBarDate } from "@/lib/markets/price-store";
import { storedAlertPreferences } from "@/lib/settings/alert-preferences";
import type { SettingsDocument } from "@/lib/settings/document";

import { isAlphaRadarAlertMetric } from "./metrics";
import {
    planAlertFirings,
    type AlertableChange,
    type AlertFiring,
    type AlertPreferences,
    type PlannedRule,
    type StoredClose,
    type UserAccounts,
    type UserOverlap,
} from "./nightly-plan";

type Database = typeof db;

export const ALERTS_JOB = "alerts";
export const NOTIFICATION_RETENTION_DAYS = 180;
const WRITE_CHUNK = 500;

export interface AlertsJobDetail {
    /** The session market rules were evaluated on. */
    session: string | null;
    rules: number;
    fired: number;
    pruned: number;
}

function uniq<T>(values: Iterable<T>): T[] {
    return [...new Set(values)];
}

/** When the job last succeeded: Alpha Radar changes stored before then were already seen. */
export async function lastSuccessfulRun(database: Database = db): Promise<Date | null> {
    const [row] = await database
        .select({ startedAt: jobRuns.startedAt })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, ALERTS_JOB), eq(jobRuns.status, "succeeded")))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
    return row?.startedAt ?? null;
}

/** Each user's cash and positions across their accounts; users without an account are left out. */
async function loadAccounts(userIds: string[], database: Database): Promise<Map<string, UserAccounts>> {
    const accounts = new Map<string, { cash: number; positions: { symbol: string; quantity: number; avgCost: number }[] }>();
    if (userIds.length === 0) return accounts;
    const [cash, positions] = await Promise.all([
        database
            .select({ userId: portfolios.userId, cash: sql<number>`coalesce(sum(${portfolios.cashBalance}), 0)`.mapWith(Number) })
            .from(portfolios)
            .where(inArray(portfolios.userId, userIds))
            .groupBy(portfolios.userId),
        database
            .select({ userId: portfolios.userId, symbol: holdings.symbol, quantity: holdings.quantity, avgCost: holdings.avgCost })
            .from(holdings)
            .innerJoin(portfolios, eq(portfolios.id, holdings.portfolioId))
            .where(inArray(portfolios.userId, userIds)),
    ]);
    for (const row of cash) accounts.set(row.userId, { cash: row.cash, positions: [] });
    for (const row of positions) {
        accounts.get(row.userId)?.positions.push({ symbol: row.symbol.toUpperCase(), quantity: Number(row.quantity), avgCost: Number(row.avgCost) });
    }
    return accounts;
}

/** The tickers each user holds, watches or has an open thesis on. */
async function loadOverlap(userIds: string[], accounts: ReadonlyMap<string, UserAccounts>, database: Database): Promise<Map<string, UserOverlap>> {
    const overlap = new Map<string, { holdings: Set<string>; watchlist: Set<string>; theses: Set<string> }>();
    if (userIds.length === 0) return overlap;
    for (const userId of userIds) {
        overlap.set(userId, {
            holdings: new Set(accounts.get(userId)?.positions.map((p) => p.symbol)),
            watchlist: new Set(),
            theses: new Set(),
        });
    }
    const [watched, thesisTickers] = await Promise.all([
        database.select({ userId: watchlistItems.userId, ticker: watchlistItems.ticker }).from(watchlistItems)
            .where(and(inArray(watchlistItems.userId, userIds), eq(watchlistItems.dismissed, false))),
        database.select({ userId: theses.userId, ticker: theses.ticker }).from(theses)
            .where(and(inArray(theses.userId, userIds), eq(theses.dismissed, false), ne(theses.status, "archived"))),
    ]);
    for (const row of watched) overlap.get(row.userId)?.watchlist.add(row.ticker.toUpperCase());
    for (const row of thesisTickers) overlap.get(row.userId)?.theses.add(row.ticker.toUpperCase());
    return overlap;
}

async function loadChanges(after: Date, database: Database): Promise<AlertableChange[]> {
    const rows = await database
        .select({
            trackedFilerId: alphaRadarHoldingChanges.trackedFilerId,
            filerName: alphaRadarTrackedFilers.name,
            reportPeriod: alphaRadarHoldingChanges.reportPeriod,
            cusip: alphaRadarHoldingChanges.cusip,
            ticker: alphaRadarHoldingChanges.ticker,
            issuerName: alphaRadarHoldingChanges.issuerName,
            changeType: alphaRadarHoldingChanges.changeType,
            materialityScore: alphaRadarHoldingChanges.materialityScore,
            createdAt: alphaRadarHoldingChanges.createdAt,
        })
        .from(alphaRadarHoldingChanges)
        .innerJoin(alphaRadarTrackedFilers, eq(alphaRadarTrackedFilers.id, alphaRadarHoldingChanges.trackedFilerId))
        .where(gt(alphaRadarHoldingChanges.createdAt, after));
    return rows;
}

/** Records the firings once each, and updates their rules; returns how many were new. */
async function recordFirings(firings: readonly AlertFiring[], now: Date, database: Database): Promise<number> {
    let recorded = 0;
    for (let start = 0; start < firings.length; start += WRITE_CHUNK) {
        const chunk = firings.slice(start, start + WRITE_CHUNK);
        recorded += await database.transaction(async (tx) => {
            const inserted = await tx
                .insert(alertNotifications)
                .values(chunk.map((f) => ({ ...f, triggeredAt: now })))
                .onConflictDoNothing({ target: [alertNotifications.ruleId, alertNotifications.occurrence] })
                .returning({ ruleId: alertNotifications.ruleId });
            const fired = uniq(inserted.map((row) => row.ruleId));
            if (fired.length > 0) {
                await tx
                    .update(alertRules)
                    .set({
                        lastTriggeredAt: now,
                        enabled: sql`case when ${alertRules.rearm} = 'once' then false else ${alertRules.enabled} end`,
                    })
                    .where(inArray(alertRules.id, fired));
            }
            return inserted.length;
        });
    }
    return recorded;
}

export async function evaluateAlertRules({
    now = new Date(),
    database = db,
}: { now?: Date; database?: Database } = {}): Promise<AlertsJobDetail> {
    const pruned = await database
        .delete(alertNotifications)
        .where(lt(alertNotifications.triggeredAt, new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)))
        .returning({ id: alertNotifications.id });

    const rows = await database.select().from(alertRules).where(eq(alertRules.enabled, true));
    if (rows.length === 0) return { session: null, rules: 0, fired: 0, pruned: pruned.length };

    const rules: PlannedRule[] = rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        metric: row.metric as PlannedRule["metric"],
        symbol: row.symbol,
        comparator: row.comparator as PlannedRule["comparator"],
        threshold: row.threshold,
        rearm: row.rearm as PlannedRule["rearm"],
        createdAt: row.createdAt,
    }));
    const userIds = uniq(rules.map((rule) => rule.userId));
    const portfolioUsers = uniq(rules.filter((r) => r.metric === "portfolio_value" || r.metric === "portfolio_day_change_pct").map((r) => r.userId));
    const alphaRules = rules.filter((rule) => isAlphaRadarAlertMetric(rule.metric));
    const alphaUsers = uniq(alphaRules.map((rule) => rule.userId));

    const [session, settingsRows, accounts, since] = await Promise.all([
        getLatestBarDate(database),
        database.select().from(userSettings).where(inArray(userSettings.userId, userIds)),
        loadAccounts(uniq([...portfolioUsers, ...alphaUsers]), database),
        alphaRules.length > 0 ? lastSuccessfulRun(database) : Promise.resolve(null),
    ]);

    const stored = new Map(settingsRows.map((row) => [row.userId, { version: row.version, settings: row.settings as SettingsDocument["settings"] }]));
    const preferences = new Map<string, AlertPreferences>(userIds.map((userId) => [userId, storedAlertPreferences(stored.get(userId) ?? null)]));

    const symbols = uniq([
        ...rules.flatMap((rule) => (rule.symbol ? [rule.symbol] : [])),
        ...portfolioUsers.flatMap((userId) => accounts.get(userId)?.positions.map((p) => p.symbol) ?? []),
    ]);
    const closes = new Map<string, StoredClose[]>();
    if (session && symbols.length > 0) {
        for (const row of await buildRecentClosesQuery(symbols, 2, database)) {
            const list = closes.get(row.symbol) ?? [];
            list.push({ date: row.date, close: Number(row.close) });
            closes.set(row.symbol, list);
        }
    }

    let changes: AlertableChange[] = [];
    if (alphaRules.length > 0) {
        const earliest = alphaRules.reduce((min, rule) => {
            const from = since && since > rule.createdAt ? since : rule.createdAt;
            return from < min ? from : min;
        }, now);
        changes = await loadChanges(earliest, database);
    }
    const overlap = changes.length > 0 ? await loadOverlap(alphaUsers, accounts, database) : new Map<string, UserOverlap>();

    const firings = planAlertFirings({
        rules,
        session,
        closes,
        accounts: new Map([...accounts].filter(([userId]) => portfolioUsers.includes(userId))),
        overlap,
        changes,
        preferences,
        alphaRadarSince: since,
        runDate: now.toISOString().slice(0, 10),
    });
    const fired = firings.length > 0 ? await recordFirings(firings, now, database) : 0;
    return { session, rules: rules.length, fired, pruned: pruned.length };
}
