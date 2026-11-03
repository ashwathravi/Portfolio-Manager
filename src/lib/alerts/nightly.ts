/**
 * Nightly job "alerts" (launch item i57): evaluates every enabled alert
 * rule after the day's closes and valuation snapshots are stored, and adds
 * what they raise to each user's notification feed. The rules themselves
 * are in ./nightly-plan.ts; this reads what they need and writes the result.
 *
 * A notification is inserted once per rule and occurrence
 * (alert_notifications_rule_occurrence_idx), and the plan leaves out
 * occurrences a rule already raised, cleared ones included: running the
 * job again, or on a market holiday when the newest session is unchanged,
 * adds nothing. A rule set to fire once is paused when it does.
 * Notifications older than NOTIFICATION_RETENTION_DAYS are deleted.
 *
 * Stored closes are split-adjusted, so an accounts rule waits, as the
 * valuation snapshots do, until the latest price run has checked held
 * positions against splits through the session, and a user still holding
 * a position from before a split that couldn't be applied is left out:
 * old share counts at post-split prices would raise a false alert.
 */

import { and, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";

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
import { awaitsSplit, buildLatestHoldingSplitsQuery, splitReadiness, type SplitReadiness } from "@/lib/portfolio/valuation-snapshots";
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
    /** Users whose accounts rules waited for split adjustments. */
    accountsWaiting: number;
    /** Why every accounts rule waited, when the split check hasn't caught up. */
    splitCheck?: string;
}

function uniq<T>(values: Iterable<T>): T[] {
    return [...new Set(values)];
}

export function buildPruneAlertsQuery(now: Date, database: Database = db) {
    return database
        .delete(alertNotifications)
        .where(lt(alertNotifications.triggeredAt, new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)))
        .returning({ id: alertNotifications.id });
}

export function buildEnabledRulesQuery(database: Database = db) {
    return database.select().from(alertRules).where(eq(alertRules.enabled, true));
}

/** When the job last succeeded: Alpha Radar changes stored before then were already seen. */
export function buildLastSuccessfulRunQuery(database: Database = db) {
    return database
        .select({ startedAt: jobRuns.startedAt })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, ALERTS_JOB), eq(jobRuns.status, "succeeded")))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
}

export function buildAccountCashQuery(userIds: string[], database: Pick<Database, "select"> = db) {
    return database
        .select({ userId: portfolios.userId, cash: sql<number>`coalesce(sum(${portfolios.cashBalance}), 0)`.mapWith(Number) })
        .from(portfolios)
        .where(inArray(portfolios.userId, userIds))
        .groupBy(portfolios.userId);
}

export function buildAccountPositionsQuery(userIds: string[], database: Pick<Database, "select"> = db) {
    return database
        .select({ userId: portfolios.userId, symbol: holdings.symbol, quantity: holdings.quantity, avgCost: holdings.avgCost, updatedAt: holdings.updatedAt })
        .from(holdings)
        .innerJoin(portfolios, eq(portfolios.id, holdings.portfolioId))
        .where(inArray(portfolios.userId, userIds));
}

/**
 * Each user's cash and positions across their accounts; users without an
 * account are left out. Read in one repeatable-read snapshot, so a sync that
 * replaces an account's holdings and cash together (src/lib/plaid/sync.ts)
 * is seen whole or not at all.
 */
export async function loadAccounts(userIds: string[], database: Database = db): Promise<Map<string, UserAccounts>> {
    const accounts = new Map<string, { cash: number; positions: UserAccounts["positions"][number][] }>();
    if (userIds.length === 0) return accounts;
    const [cash, positions] = await database.transaction(async (tx) => [
        await buildAccountCashQuery(userIds, tx),
        await buildAccountPositionsQuery(userIds, tx),
    ] as const, { isolationLevel: "repeatable read", accessMode: "read only" });
    for (const row of cash) accounts.set(row.userId, { cash: row.cash, positions: [] });
    for (const row of positions) {
        accounts.get(row.userId)?.positions.push({
            symbol: row.symbol.toUpperCase(),
            quantity: Number(row.quantity),
            avgCost: Number(row.avgCost),
            updatedAt: row.updatedAt,
        });
    }
    return accounts;
}

/**
 * The users whose accounts can be valued at the session's split-adjusted
 * closes, and how many wait: everyone while the split check hasn't caught
 * up, else those still holding a position from before a split that
 * couldn't be applied.
 */
export function accountsOnSessionScale(
    accounts: ReadonlyMap<string, UserAccounts>,
    readiness: SplitReadiness,
): { ready: Map<string, UserAccounts>; waiting: number } {
    if (!readiness.ready) return { ready: new Map(), waiting: accounts.size };
    const ready = new Map([...accounts].filter(([, user]) => !user.positions.some((p) => awaitsSplit(p, readiness.unadjusted))));
    return { ready, waiting: accounts.size - ready.size };
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

/** Alpha Radar changes stored after `after`, with their filer's name. */
export function buildChangesSinceQuery(after: Date, database: Database = db) {
    return database
        .select({
            trackedFilerId: alphaRadarHoldingChanges.trackedFilerId,
            filerName: alphaRadarTrackedFilers.name,
            reportPeriod: alphaRadarHoldingChanges.reportPeriod,
            currentFilingId: alphaRadarHoldingChanges.currentFilingId,
            priorFilingId: alphaRadarHoldingChanges.priorFilingId,
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
}

/**
 * The occurrences each rule already raised (cleared ones included): this
 * session's for market rules, every change for Alpha Radar ones. Null with
 * nothing to look up.
 */
export function buildNotifiedQuery(rules: readonly PlannedRule[], session: string | null, database: Database = db) {
    const market = rules.filter((rule) => !isAlphaRadarAlertMetric(rule.metric)).map((rule) => rule.id);
    const alpha = rules.filter((rule) => isAlphaRadarAlertMetric(rule.metric)).map((rule) => rule.id);
    const conditions = [
        session && market.length > 0
            ? and(inArray(alertNotifications.ruleId, market), eq(alertNotifications.occurrence, `session:${session}`))
            : undefined,
        alpha.length > 0 ? inArray(alertNotifications.ruleId, alpha) : undefined,
    ].filter((condition) => condition !== undefined);
    if (conditions.length === 0) return null;
    return database
        .select({ ruleId: alertNotifications.ruleId, occurrence: alertNotifications.occurrence })
        .from(alertNotifications)
        .where(or(...conditions));
}

async function loadNotified(rules: readonly PlannedRule[], session: string | null, database: Database) {
    const notified = new Map<string, Set<string>>();
    const query = buildNotifiedQuery(rules, session, database);
    for (const row of query ? await query : []) {
        const seen = notified.get(row.ruleId) ?? new Set<string>();
        seen.add(row.occurrence);
        notified.set(row.ruleId, seen);
    }
    return notified;
}

/**
 * The rules among `ruleIds` still there and still on, locked until the
 * transaction ends: one deleted or paused since the job read the rules
 * raises nothing, and can't be deleted while its alerts are written.
 */
export function buildLockLiveRulesQuery(ruleIds: string[], database: Pick<Database, "select"> = db) {
    return database
        .select({ id: alertRules.id })
        .from(alertRules)
        .where(and(inArray(alertRules.id, ruleIds), eq(alertRules.enabled, true)))
        .for("update");
}

/**
 * Records the firings once each, and updates their rules; returns how many
 * were new. Firings of a rule deleted or paused since the rules were read
 * are dropped, so one user's deletion can't fail everyone's batch on the
 * rule foreign key.
 */
export async function recordFirings(firings: readonly AlertFiring[], now: Date, database: Database = db): Promise<number> {
    let recorded = 0;
    for (let start = 0; start < firings.length; start += WRITE_CHUNK) {
        const planned = firings.slice(start, start + WRITE_CHUNK);
        recorded += await database.transaction(async (tx) => {
            const live = new Set((await buildLockLiveRulesQuery(uniq(planned.map((f) => f.ruleId)), tx)).map((row) => row.id));
            const chunk = planned.filter((f) => live.has(f.ruleId));
            if (chunk.length === 0) return 0;
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
    const pruned = await buildPruneAlertsQuery(now, database);

    const rows = await buildEnabledRulesQuery(database);
    if (rows.length === 0) return { session: null, rules: 0, fired: 0, pruned: pruned.length, accountsWaiting: 0 };

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
        lastTriggeredAt: row.lastTriggeredAt,
    }));
    const userIds = uniq(rules.map((rule) => rule.userId));
    const portfolioUsers = uniq(rules.filter((r) => r.metric === "portfolio_value" || r.metric === "portfolio_day_change_pct").map((r) => r.userId));
    const alphaRules = rules.filter((rule) => isAlphaRadarAlertMetric(rule.metric));
    const alphaUsers = uniq(alphaRules.map((rule) => rule.userId));

    const [session, settingsRows, accounts, lastRun, holdingSplits] = await Promise.all([
        getLatestBarDate(database),
        database.select().from(userSettings).where(inArray(userSettings.userId, userIds)),
        loadAccounts(uniq([...portfolioUsers, ...alphaUsers]), database),
        alphaRules.length > 0 ? buildLastSuccessfulRunQuery(database) : Promise.resolve([]),
        portfolioUsers.length > 0 ? buildLatestHoldingSplitsQuery(database) : Promise.resolve([]),
    ]);
    const since = lastRun[0]?.startedAt ?? null;
    const readiness = session
        ? splitReadiness(holdingSplits[0]?.holdingSplits, session)
        : { ready: false as const, reason: "no closes stored yet" };
    const valued = accountsOnSessionScale(new Map([...accounts].filter(([userId]) => portfolioUsers.includes(userId))), readiness);

    const stored = new Map(settingsRows.map((row) => [row.userId, { version: row.version, settings: row.settings as SettingsDocument["settings"] }]));
    const preferences = new Map<string, AlertPreferences>(userIds.map((userId) => [userId, storedAlertPreferences(stored.get(userId) ?? null)]));

    const symbols = uniq([
        ...rules.flatMap((rule) => (rule.symbol ? [rule.symbol] : [])),
        ...[...valued.ready.values()].flatMap((user) => user.positions.map((p) => p.symbol)),
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
        changes = await buildChangesSinceQuery(earliest, database);
    }
    const [overlap, notified] = await Promise.all([
        changes.length > 0 ? loadOverlap(alphaUsers, accounts, database) : Promise.resolve(new Map<string, UserOverlap>()),
        loadNotified(rules, session, database),
    ]);

    const firings = planAlertFirings({
        rules,
        session,
        closes,
        accounts: valued.ready,
        overlap,
        changes,
        preferences,
        alphaRadarSince: since,
        notified,
        runDate: now.toISOString().slice(0, 10),
    });
    const fired = firings.length > 0 ? await recordFirings(firings, now, database) : 0;
    return {
        session,
        rules: rules.length,
        fired,
        pruned: pruned.length,
        accountsWaiting: valued.waiting,
        ...(!readiness.ready && portfolioUsers.length > 0 ? { splitCheck: readiness.reason } : {}),
    };
}
