import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { ALERT_RULES_PER_USER, alertRuleInputSchema } from "@/lib/validators/alerts";

import {
    AlertRuleLimitError,
    buildDeleteAlertRuleQuery,
    buildListAlertRulesQuery,
    buildUpdateAlertRuleQuery,
    createAlertRule,
    deleteAlertRule,
    toAlertRule,
    updateAlertRule,
} from "./rules";

const USER = "00000000-0000-4000-8000-00000000a001";
const RULE_ID = "00000000-0000-4000-8000-000000000401";
const NOW = new Date("2026-11-02T15:00:00.000Z");

const PORTFOLIO_RULE = alertRuleInputSchema.parse({
    name: "Worth $100k", metric: "portfolio_value", comparator: "gte", threshold: 100000, enabled: true, rearm: "daily",
});

function storedRow(overrides: Partial<Parameters<typeof toAlertRule>[0]> = {}): Parameters<typeof toAlertRule>[0] {
    return {
        id: RULE_ID, userId: USER, name: "AAPL above $200", metric: "price", symbol: "AAPL", comparator: "gte", threshold: 200,
        rearm: "daily", enabled: true, note: null, lastTriggeredAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
    };
}

describe("alert rule queries (launch item i57)", () => {
    test("the list is one user's rules, oldest first", () => {
        const { sql, params } = buildListAlertRulesQuery(USER).toSQL();
        assert.match(sql, /from "alert_rules" where "alert_rules"\."user_id" = \$1 order by "alert_rules"\."created_at" asc, "alert_rules"\."id" asc$/);
        assert.deepEqual(params, [USER]);
    });

    test("an update replaces only the user's rule with that id, never its owner or history", () => {
        const { sql, params } = buildUpdateAlertRuleQuery(USER, RULE_ID, PORTFOLIO_RULE, NOW).toSQL();
        assert.match(sql, /^update "alert_rules" set "name" = \$1, "metric" = \$2, "symbol" = \$3, "comparator" = \$4, "threshold" = \$5, "rearm" = \$6, "enabled" = \$7, "note" = \$8, "updated_at" = \$9 where \("alert_rules"\."id" = \$10 and "alert_rules"\."user_id" = \$11\)/);
        assert.doesNotMatch(sql.split(" where ")[0], /user_id|created_at|last_triggered_at/);
        assert.deepEqual(params.slice(-2), [RULE_ID, USER]);
    });

    test("a delete removes only the user's rule with that id", () => {
        const { sql, params } = buildDeleteAlertRuleQuery(USER, RULE_ID).toSQL();
        assert.match(sql, /^delete from "alert_rules" where \("alert_rules"\."id" = \$1 and "alert_rules"\."user_id" = \$2\) returning "id"$/);
        assert.deepEqual(params, [RULE_ID, USER]);
    });
});

describe("toAlertRule", () => {
    test("a stored rule as Settings shows it: its kind, and no empty fields", () => {
        assert.deepEqual(toAlertRule(storedRow()), {
            id: RULE_ID, name: "AAPL above $200", metric: "price", symbol: "AAPL", comparator: "gte", threshold: 200,
            enabled: true, rearm: "daily", source: "market", createdAt: NOW.toISOString(),
        });
        const radar = toAlertRule(storedRow({ metric: "alpha_radar_exit", symbol: null, note: "Check the memo", lastTriggeredAt: NOW }));
        assert.equal(radar.source, "alpha_radar");
        assert.equal("symbol" in radar, false);
        assert.equal(radar.note, "Check the memo");
        assert.equal(radar.lastTriggeredAt, NOW.toISOString());
    });
});

/** A database whose transaction counts `existing` rules and records what's inserted. */
function fakeDatabase(existing: number) {
    const calls: string[] = [];
    const inserted: unknown[] = [];
    const tx = {
        execute: async () => { calls.push("lock"); },
        select: () => ({ from: () => ({ where: async () => { calls.push("count"); return [{ value: existing }]; } }) }),
        insert: () => ({
            values: (values: Record<string, unknown>) => {
                inserted.push(values);
                return { returning: async () => [storedRow({ ...values, id: RULE_ID } as Partial<Parameters<typeof toAlertRule>[0]>)] };
            },
        }),
    };
    const database = { transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx) } as unknown as typeof db;
    return { database, calls, inserted };
}

describe("createAlertRule", () => {
    test("adds the rule for the user, after taking the user's lock and counting their rules", async () => {
        const { database, calls, inserted } = fakeDatabase(ALERT_RULES_PER_USER - 1);
        const rule = await createAlertRule(USER, PORTFOLIO_RULE, { database, now: NOW });
        assert.deepEqual(calls, ["lock", "count"]);
        assert.deepEqual(inserted, [{ userId: USER, ...PORTFOLIO_RULE, createdAt: NOW, updatedAt: NOW }]);
        assert.equal(rule.metric, "portfolio_value");
        assert.equal("symbol" in rule, false);
    });

    test(`refuses a rule past ${ALERT_RULES_PER_USER}, inserting nothing`, async () => {
        const { database, inserted } = fakeDatabase(ALERT_RULES_PER_USER);
        await assert.rejects(createAlertRule(USER, PORTFOLIO_RULE, { database }), AlertRuleLimitError);
        assert.deepEqual(inserted, []);
    });
});

describe("updateAlertRule and deleteAlertRule", () => {
    test("say when the user has no rule with that id", async () => {
        const database = {
            update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
            delete: () => ({ where: () => ({ returning: async () => [] }) }),
        } as unknown as typeof db;
        assert.equal(await updateAlertRule(USER, RULE_ID, PORTFOLIO_RULE, { database }), null);
        assert.equal(await deleteAlertRule(USER, RULE_ID, database), false);
    });
});
