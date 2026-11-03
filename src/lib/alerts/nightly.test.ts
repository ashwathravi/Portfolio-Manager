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
    buildNotifiedQuery,
    buildPruneAlertsQuery,
    evaluateAlertRules,
    NOTIFICATION_RETENTION_DAYS,
} from "./nightly";
import type { PlannedRule, UserAccounts } from "./nightly-plan";

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
