import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { SecurityProfile } from "@/lib/markets/security-profile";
import type { StoredClose } from "@/lib/portfolio/valuation-snapshots";
import { MIN_STYLE_RETURNS, SECTOR_ETFS } from "./attribution-history";
import { buildAttributionHistory } from "./attribution-loader";
import type { ReturnHistoryRows } from "./return-history";

const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";

/** Weekdays ending at `last`, `count` of them, oldest first. */
function sessionsUntil(last: string, count: number): string[] {
    const out: string[] = [];
    const at = new Date(`${last}T12:00:00Z`);
    while (out.length < count) {
        if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) out.unshift(at.toISOString().slice(0, 10));
        at.setUTCDate(at.getUTCDate() - 1);
    }
    return out;
}

/** SPY and the sector ETFs on `dates`, SPY half technology and half consumer discretionary. */
function etfCloses(dates: readonly string[]): Map<string, StoredClose[]> {
    const out = new Map<string, StoredClose[]>();
    const level = new Map<string, number>([["SPY", 500], ...SECTOR_ETFS.map((e) => [e, 100] as [string, number])]);
    dates.forEach((date, t) => {
        if (t > 0) {
            let spy = 0;
            SECTOR_ETFS.forEach((etf, i) => {
                const r = 0.01 * Math.sin(1.3 * t + i) + 0.003 * Math.cos(0.7 * t * (i + 1));
                level.set(etf, level.get(etf)! * (1 + r));
                if (etf === "XLK" || etf === "XLY") spy += 0.5 * r;
            });
            level.set("SPY", level.get("SPY")! * (1 + spy));
        }
        for (const [symbol, close] of level) out.set(symbol, [...(out.get(symbol) ?? []), { date, close }]);
    });
    return out;
}

const rows: ReturnHistoryRows = {
    accounts: [{ id: "main", name: "Main" }, { id: "ira", name: "IRA" }],
    snapshots: [
        { portfolioId: "main", date: MON, totalValue: 7000 },
        { portfolioId: "ira", date: MON, totalValue: 4000 },
        { portfolioId: "main", date: TUE, totalValue: 7600 },
        { portfolioId: "ira", date: TUE, totalValue: 3800 },
        { portfolioId: "main", date: WED, totalValue: 7600 },
        { portfolioId: "ira", date: WED, totalValue: 3800 },
    ],
    positions: [
        { portfolioId: "main", date: MON, symbol: "KO", marketValue: 6000 },
        { portfolioId: "ira", date: MON, symbol: "MSFT", marketValue: 4000 },
        { portfolioId: "main", date: TUE, symbol: "KO", marketValue: 6600 },
        { portfolioId: "ira", date: TUE, symbol: "MSFT", marketValue: 3800 },
        { portfolioId: "main", date: WED, symbol: "KO", marketValue: 6600 },
        { portfolioId: "ira", date: WED, symbol: "MSFT", marketValue: 3800 },
    ],
};

const PROFILES = new Map<string, SecurityProfile>([
    ["KO", { symbol: "KO", name: "Coca-Cola", type: "CS", sector: "Consumer", industry: null }],
]);

function loaders(etfDays = 100) {
    const calls: Array<{ symbols: string[]; from: string; to: string }> = [];
    const etfs = etfCloses(sessionsUntil(WED, etfDays));
    return {
        calls,
        loadCloses: async (symbols: string[], from: string, to: string) => {
            calls.push({ symbols, from, to });
            const out = new Map<string, StoredClose[]>(etfs);
            out.set("KO", [{ date: MON, close: 60 }, { date: TUE, close: 66 }, { date: WED, close: 66 }]);
            out.set("MSFT", [{ date: MON, close: 400 }, { date: TUE, close: 380 }, { date: WED, close: 380 }]);
            return out;
        },
        loadProfiles: async () => PROFILES,
    };
}

describe("buildAttributionHistory", () => {
    test("steps for all accounts together, sectors from profiles or the fallback map", async () => {
        const { calls, loadCloses, loadProfiles } = loaders();
        const history = await buildAttributionHistory(rows, null, loadCloses, loadProfiles);
        assert.equal(history.accountId, null);
        assert.deepEqual(history.dates, [MON, TUE, WED]);
        assert.equal(history.steps.length, 2);
        const first = Object.fromEntries(history.steps[0].sector.map((s) => [s.key, s]));
        // KO from its profile (Consumer); MSFT from the fallback map (Tech).
        assert.ok(Math.abs(first.consumer.weight - 6000 / 11000) < 1e-12);
        assert.ok(Math.abs(first.technology.weight - 4000 / 11000) < 1e-12);
        assert.ok(Math.abs(first.cash.weight - 1000 / 11000) < 1e-12);
        assert.ok(history.benchmark);
        assert.ok(Math.abs(history.benchmark.segments.technology - 0.5) < 1e-3);
        assert.ok(history.steps.every((s) => s.benchmarkSectorReturns !== null));
        // Held symbols, SPY and the sector ETFs, from a week before a year back.
        assert.deepEqual(calls[0].symbols, ["KO", "MSFT", "SPY", ...SECTOR_ETFS].sort());
        assert.equal(calls[0].from, "2025-09-09");
        assert.equal(calls[0].to, WED);
    });

    test("one account", async () => {
        const { loadCloses, loadProfiles } = loaders();
        const main = { ...rows, positions: rows.positions.filter((p) => p.portfolioId === "main") };
        const history = await buildAttributionHistory(main, "main", loadCloses, loadProfiles);
        assert.equal(history.accountId, "main");
        const first = Object.fromEntries(history.steps[0].sector.map((s) => [s.key, s]));
        assert.ok(Math.abs(first.consumer.weight - 6000 / 7000) < 1e-12);
        assert.equal(first.technology.weight, 0);
    });

    test("without enough sector ETF prices there's no benchmark, and no step has one", async () => {
        const { loadCloses, loadProfiles } = loaders(MIN_STYLE_RETURNS - 10);
        const history = await buildAttributionHistory(rows, null, loadCloses, loadProfiles);
        assert.equal(history.benchmark, null);
        assert.ok(history.steps.length > 0 && history.steps.every((s) => s.benchmarkSectorReturns === null));
    });

    test("fewer than two dates: no steps, no reads", async () => {
        const { calls, loadCloses, loadProfiles } = loaders();
        const one = { accounts: rows.accounts, snapshots: rows.snapshots.slice(0, 1), positions: rows.positions.slice(0, 1) };
        const history = await buildAttributionHistory(one, null, loadCloses, loadProfiles);
        assert.equal(history.hasHistory, true);
        assert.deepEqual(history.steps, []);
        assert.deepEqual(calls, []);
    });
});
