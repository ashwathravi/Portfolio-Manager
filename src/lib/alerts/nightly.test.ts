import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    ALERTS_JOB,
    accountsOnSessionScale,
    buildAccountPositionsQuery,
    buildChangesSinceQuery,
    buildEnabledRulesQuery,
    buildLastSuccessfulRunQuery,
    buildLockLiveRulesQuery,
    buildNotifiedQuery,
    buildPruneAlertsQuery,
    evaluateAlertRules,
    loadAccounts,
    NOTIFICATION_RETENTION_DAYS,
    recordFirings,
} from "./nightly";
import type { AlertFiring, PlannedRule, UserAccounts } from "./nightly-plan";

const NOW = new Date("2026-11-02T22:35:00.000Z");

function rule(id: string, metric: PlannedRule["metric"]): PlannedRule {
    return {
        id, userId: "u-1", name: id, metric, symbol: metric === "price" ? "AAPL" : null, comparator: "gte", threshold: 1,
        rearm: "daily", createdAt: NOW, lastTriggeredAt: null,
    };
}

describe("alerts job queries (launch item i57)", () => {
    test("pruning deletes alerts older than the retention period", () => {
        const { sql, params } = buildPruneAlertsQuery(NOW).toSQL();
        assert.match(sql, /^delete from "alert_notifications" where "alert_notifications"\."triggered_at" < \$1/);
        assert.deepEqual(params, [new Date(NOW.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString()]);
    });

    test("only enabled rules are evaluated", () => {
        const { sql, params } = buildEnabledRulesQuery().toSQL();
        assert.match(sql, /from "alert_rules" where "alert_rules"\."enabled" = \$1$/);
        assert.deepEqual(params, [true]);
    });

    test("the last run is this job's newest success", () => {
        const { sql, params } = buildLastSuccessfulRunQuery().toSQL();
        assert.match(sql, /from "job_runs" where \("job_runs"\."job" = \$1 and "job_runs"\."status" = \$2\) order by "job_runs"\."started_at" desc limit \$3$/);
        assert.deepEqual(params, [ALERTS_JOB, "succeeded", 1]);
    });

    test("positions are the users' own, with when each last changed (for split readiness)", () => {
        const { sql, params } = buildAccountPositionsQuery(["u-1", "u-2"]).toSQL();
        assert.match(sql, /"holdings"\."updated_at" from "holdings" inner join "portfolios" on "portfolios"\."id" = "holdings"\."portfolio_id" where "portfolios"\."user_id" in \(\$1, \$2\)$/);
        assert.deepEqual(params, ["u-1", "u-2"]);
    });

    test("Alpha Radar changes stored after a time, with the filing they came from", () => {
        const { sql, params } = buildChangesSinceQuery(NOW).toSQL();
        assert.match(sql, /"alpha_radar_holding_changes"\."current_filing_id", "alpha_radar_holding_changes"\."prior_filing_id"/);
        assert.match(sql, /where "alpha_radar_holding_changes"\."created_at" > \$1$/);
        assert.deepEqual(params, [NOW.toISOString()]);
    });

    test("what rules already raised: market rules this session, Alpha Radar rules every change; nothing to read without rules", () => {
        const both = buildNotifiedQuery([rule("r-1", "price"), rule("r-2", "alpha_radar_exit")], "2026-11-02")!.toSQL();
        assert.match(both.sql, /where \(\("alert_notifications"\."rule_id" in \(\$1\) and "alert_notifications"\."occurrence" = \$2\) or "alert_notifications"\."rule_id" in \(\$3\)\)$/);
        assert.deepEqual(both.params, ["r-1", "session:2026-11-02", "r-2"]);
        // Cleared alerts count: the query doesn't filter them out.
        assert.doesNotMatch(both.sql, /cleared/);
        assert.deepEqual(buildNotifiedQuery([rule("r-1", "price")], "2026-11-02")!.toSQL().params, ["r-1", "session:2026-11-02"]);
        assert.equal(buildNotifiedQuery([rule("r-1", "price")], null), null);
        assert.equal(buildNotifiedQuery([], "2026-11-02"), null);
    });
});

describe("loadAccounts", () => {
    test("reads cash and positions in one repeatable-read snapshot, so a sync is seen whole or not at all", async () => {
        const configs: unknown[] = [];
        const updatedAt = new Date("2026-11-02T15:00:00.000Z");
        const tx = {
            select: (fields: Record<string, unknown>) => ({
                from: () => ("cash" in fields
                    ? { where: () => ({ groupBy: async () => [{ userId: "u-1", cash: 250 }, { userId: "u-2", cash: 0 }] }) }
                    : { innerJoin: () => ({ where: async () => [{ userId: "u-1", symbol: "aapl", quantity: "10", avgCost: "150", updatedAt }] }) }),
            }),
        };
        const database = {
            transaction: async (run: (t: typeof tx) => Promise<unknown>, config: unknown) => { configs.push(config); return run(tx); },
        } as unknown as typeof db;

        const accounts = await loadAccounts(["u-1", "u-2"], database);
        assert.deepEqual(configs, [{ isolationLevel: "repeatable read", accessMode: "read only" }]);
        assert.deepEqual(Object.fromEntries(accounts), {
            "u-1": { cash: 250, positions: [{ symbol: "AAPL", quantity: 10, avgCost: 150, updatedAt }] },
            "u-2": { cash: 0, positions: [] },
        });
        assert.equal((await loadAccounts([], database)).size, 0);
        assert.equal(configs.length, 1, "nothing to read for no users");
    });
});

describe("recordFirings", () => {
    const firing = (ruleId: string): AlertFiring => ({
        ruleId, userId: "u-1", occurrence: "session:2026-11-02", ruleName: ruleId, metric: "price", symbol: "AAPL",
        comparator: "gte", threshold: 200, observedValue: 210, message: "m", href: null,
    });

    test("the rules still there and on are locked, with when each was last saved, before writing", () => {
        const { sql, params } = buildLockLiveRulesQuery(["r-1", "r-2"]).toSQL();
        assert.match(sql, /^select "id", "updated_at" from "alert_rules" where \("alert_rules"\."id" in \(\$1, \$2\) and "alert_rules"\."enabled" = \$3\) for update$/);
        assert.deepEqual(params, ["r-1", "r-2", true]);
    });

    test("writes only the firings of rules unchanged since they were read, and nothing when none is left", async () => {
        const SAVED = new Date("2026-11-01T12:00:00.000Z");
        const EDITED = new Date("2026-11-02T22:34:00.000Z");
        let inserted: Array<{ ruleId: string }> = [];
        let updated = 0;
        const tx = (live: Array<{ id: string; updatedAt: Date }>) => ({
            select: () => ({ from: () => ({ where: () => ({ for: async () => live }) }) }),
            insert: () => ({
                values: (rows: Array<{ ruleId: string }>) => {
                    inserted = rows;
                    return { onConflictDoNothing: () => ({ returning: async () => rows.map((row) => ({ ruleId: row.ruleId })) }) };
                },
            }),
            update: () => ({ set: () => ({ where: async () => { updated += 1; } }) }),
        });
        const databaseWith = (live: Array<{ id: string; updatedAt: Date }>) =>
            ({ transaction: async (run: (t: ReturnType<typeof tx>) => Promise<unknown>) => run(tx(live)) }) as unknown as typeof db;
        const evaluated = new Map([["r-live", SAVED], ["r-deleted", SAVED], ["r-edited", SAVED]]);

        // r-deleted is gone (or paused); r-edited was saved again after the job read it.
        const live = [{ id: "r-live", updatedAt: new Date(SAVED) }, { id: "r-edited", updatedAt: EDITED }];
        assert.equal(await recordFirings([firing("r-live"), firing("r-deleted"), firing("r-edited")], evaluated, NOW, databaseWith(live)), 1);
        assert.deepEqual(inserted.map((row) => row.ruleId), ["r-live"]);
        assert.equal(updated, 1);

        inserted = [];
        assert.equal(await recordFirings([firing("r-deleted"), firing("r-edited")], evaluated, NOW, databaseWith(live.slice(1))), 0);
        assert.deepEqual(inserted, []);
        assert.equal(updated, 1);
    });
});

describe("accountsOnSessionScale", () => {
    const before = new Date("2026-10-30T15:00:00.000Z");
    const after = new Date("2026-11-03T15:00:00.000Z");
    const accounts = new Map<string, UserAccounts>([
        ["u-held-back", { cash: 0, positions: [{ symbol: "NVDA", quantity: 10, avgCost: 100, updatedAt: before }] }],
        ["u-reimported", { cash: 0, positions: [{ symbol: "NVDA", quantity: 100, avgCost: 10, updatedAt: after }] }],
        ["u-other", { cash: 50, positions: [{ symbol: "AAPL", quantity: 1, avgCost: 100, updatedAt: before }] }],
    ]);

    test("every account waits while held positions haven't been checked against splits through the session", () => {
        const { ready, waiting } = accountsOnSessionScale(accounts, { ready: false, reason: "not yet" });
        assert.equal(ready.size, 0);
        assert.equal(waiting, 3);
    });

    test("a user still holding a position from before a split that couldn't be applied waits; one re-imported after it doesn't", () => {
        const { ready, waiting } = accountsOnSessionScale(accounts, { ready: true, unadjusted: [{ symbol: "NVDA", executionDate: "2026-11-02" }] });
        assert.deepEqual([...ready.keys()], ["u-reimported", "u-other"]);
        assert.equal(waiting, 1);
        assert.equal(accountsOnSessionScale(accounts, { ready: true, unadjusted: [] }).ready.size, 3);
    });
});

describe("evaluateAlertRules", () => {
    test("without enabled rules it only prunes", async () => {
        const calls: string[] = [];
        const database = {
            delete: () => ({ where: () => ({ returning: async () => { calls.push("prune"); return [{ id: "old-1" }, { id: "old-2" }]; } }) }),
            select: () => ({ from: () => ({ where: async () => { calls.push("rules"); return []; } }) }),
        } as unknown as typeof db;
        assert.deepEqual(await evaluateAlertRules({ database, now: NOW }), { session: null, rules: 0, fired: 0, pruned: 2, accountsWaiting: 0 });
        assert.deepEqual(calls, ["prune", "rules"]);
    });
});
