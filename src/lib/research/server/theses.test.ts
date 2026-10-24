import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { theses, thesisCatalysts, thesisEvidence } from "@/db/schema";
import type { ThesisInput } from "@/lib/validators/thesis";

import {
    buildImportThesesQuery,
    buildListCatalystsQuery,
    buildListEvidenceQuery,
    buildListThesesQuery,
    buildSaveThesisQuery,
    importTheses,
    loadTheses,
    saveThesis,
} from "./theses";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-10-23T08:00:00.000Z");
const ORDER = { session: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", seq: 7 };

const THESIS: ThesisInput = {
    id: "b2c1a0f4-0d7e-4c55-9e1b-5c2c3e7a8f90",
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    title: "AI infrastructure",
    description: "Data-centre demand",
    type: "bull",
    status: "active",
    conviction: "HIGH",
    targetPrice: 950,
    currentPrice: null,
    timeHorizon: "18 months",
    dateCreated: "2026-10-01",
    dateUpdated: "2026-10-23",
    tags: ["AI"],
    hypothesis: "Share holds",
    bullCase: ["CUDA moat"],
    bearCase: ["Custom silicon"],
    catalysts: [
        { id: "cat-1", title: "Earnings", date: "Q2 2026", impact: "high" },
        { id: "cat-2", title: "GTC", date: "2026-03-18", impact: "medium" },
    ],
    linkedEvidence: [{ id: "ev-1", title: "Transcript", type: "earnings", date: "2026-10-20", url: "https://example.com/t" }],
    healthScore: 70,
    dismissed: false,
};

describe("thesis queries", () => {
    test("lists read one user's rows: theses newest first, children in order", () => {
        const list = buildListThesesQuery(USER).toSQL();
        assert.match(list.sql, /from "theses" where "theses"\."user_id" = \$1 order by "theses"\."created_at" desc, "theses"\."id" asc/i);
        assert.deepEqual(list.params, [USER]);
        assert.match(buildListCatalystsQuery(USER).toSQL().sql, /from "thesis_catalysts" where "thesis_catalysts"\."user_id" = \$1 order by "thesis_catalysts"\."thesis_id" asc, "thesis_catalysts"\."position" asc/i);
        assert.match(buildListEvidenceQuery(USER).toSQL().sql, /from "thesis_evidence" where "thesis_evidence"\."user_id" = \$1 order by "thesis_evidence"\."thesis_id" asc, "thesis_evidence"\."position" asc/i);
    });

    test("save replaces the user's row with that id unless the same page wrote it later, and says whether it did", () => {
        const { sql, params } = buildSaveThesisQuery(USER, THESIS, ORDER, NOW).toSQL();
        assert.match(sql, /^insert into "theses"/i);
        assert.match(sql, /on conflict \("user_id","id"\) do update set .* where \("theses"\."write_session" is distinct from \$\d+ or "theses"\."write_seq" < \$\d+\) returning "id"$/i);
        // The key and the created time aren't updated.
        const update = sql.split("do update set")[1] ?? "";
        assert.doesNotMatch(update, /"user_id" =|"id" =|"created_at"/);
        assert.ok(params.includes(JSON.stringify(["CUDA moat"])));
        assert.ok(params.includes(ORDER.session));
    });

    test("a deleted thesis keeps only what identifies it", () => {
        const { params } = buildSaveThesisQuery(USER, { ...THESIS, dismissed: true }, ORDER, NOW).toSQL();
        for (const text of [THESIS.title, THESIS.description, THESIS.hypothesis, THESIS.companyName, JSON.stringify(THESIS.bullCase)]) {
            assert.ok(!params.includes(text), text);
        }
        assert.ok(params.includes(THESIS.ticker));
        assert.ok(params.includes(true));
    });

    test("import keeps the browser's order across batches and leaves theses the user already has", () => {
        const startedAt = NOW.getTime() - 5_000;
        const { sql, params } = buildImportThesesQuery(USER, { items: [THESIS], first: 3, startedAt }, NOW).toSQL();
        assert.match(sql, /on conflict do nothing returning "id"$/i);
        assert.ok(params.includes(new Date(startedAt - 3).toISOString()));
        const ahead = buildImportThesesQuery(USER, { items: [THESIS], startedAt: NOW.getTime() + 60_000 }, NOW).toSQL();
        assert.ok(ahead.params.includes(NOW.toISOString()));
    });
});

/** A database whose transaction records what it was asked to do. */
function fakeDatabase({ saved = true, inserted = [] as string[] } = {}) {
    const calls: { op: string; table: unknown; rows?: unknown[] }[] = [];
    const tx = {
        insert: (table: unknown) => ({
            values: (rows: unknown) => {
                const list = Array.isArray(rows) ? rows : [rows];
                if (table !== theses) {
                    calls.push({ op: "insert", table, rows: list });
                    return Promise.resolve();
                }
                return {
                    onConflictDoUpdate: () => ({ returning: async () => (saved ? [{ id: THESIS.id }] : []) }),
                    onConflictDoNothing: () => ({ returning: async () => inserted.map((id) => ({ id })) }),
                };
            },
        }),
        delete: (table: unknown) => ({ where: async () => { calls.push({ op: "delete", table }); } }),
    };
    const database = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
    return { database, calls };
}

describe("saveThesis", () => {
    test("replaces the thesis's catalysts and evidence, in order", async () => {
        const { database, calls } = fakeDatabase();
        assert.equal(await saveThesis(USER, THESIS, ORDER, { now: NOW, database }), true);
        assert.deepEqual(calls.map((c) => [c.op, c.table === thesisCatalysts ? "catalysts" : "evidence"]), [
            ["delete", "catalysts"], ["delete", "evidence"], ["insert", "catalysts"], ["insert", "evidence"],
        ]);
        assert.deepEqual(calls[2].rows, [
            { userId: USER, thesisId: THESIS.id, id: "cat-1", position: 0, title: "Earnings", date: "Q2 2026", impact: "high" },
            { userId: USER, thesisId: THESIS.id, id: "cat-2", position: 1, title: "GTC", date: "2026-03-18", impact: "medium" },
        ]);
        assert.deepEqual(calls[3].rows, [
            { userId: USER, thesisId: THESIS.id, id: "ev-1", position: 0, title: "Transcript", type: "earnings", date: "2026-10-20", url: "https://example.com/t" },
        ]);
    });

    test("an older write from the same page changes nothing", async () => {
        const { database, calls } = fakeDatabase({ saved: false });
        assert.equal(await saveThesis(USER, THESIS, ORDER, { now: NOW, database }), false);
        assert.deepEqual(calls, []);
    });

    test("a deleted thesis keeps no catalysts or evidence", async () => {
        const { database, calls } = fakeDatabase();
        await saveThesis(USER, { ...THESIS, dismissed: true }, ORDER, { now: NOW, database });
        assert.deepEqual(calls.map((c) => c.op), ["delete", "delete"]);
    });
});

describe("importTheses", () => {
    test("adds catalysts and evidence only for theses the account didn't have", async () => {
        const other = { ...THESIS, id: "c3d2b1a0-0000-4000-8000-000000000002" };
        const { database, calls } = fakeDatabase({ inserted: [other.id] });
        await importTheses(USER, { items: [THESIS, other] }, { now: NOW, database });
        const thesisIds = calls.flatMap((c) => (c.rows ?? []) as { thesisId: string }[]).map((row) => row.thesisId);
        assert.ok(thesisIds.length > 0);
        assert.ok(thesisIds.every((id) => id === other.id));
    });

    test("writes nothing for an empty batch", async () => {
        const database = { transaction: () => assert.fail("nothing to write") } as unknown as typeof db;
        await importTheses(USER, { items: [] }, { database });
    });
});

describe("loadTheses", () => {
    test("puts each thesis's catalysts and evidence back, and lists deleted theses apart", async () => {
        const row = (thesis: ThesisInput) => ({
            userId: USER, ...thesis, writeSession: null, writeSeq: null, createdAt: NOW, updatedAt: NOW,
        });
        const deleted = { ...THESIS, id: "seed-meta", dismissed: true };
        const results = new Map<unknown, unknown[]>([
            [theses, [row(THESIS), row(deleted)]],
            [thesisCatalysts, THESIS.catalysts.map((c, position) => ({ userId: USER, thesisId: THESIS.id, position, ...c }))],
            [thesisEvidence, THESIS.linkedEvidence.map((e, position) => ({ userId: USER, thesisId: THESIS.id, position, ...e }))],
        ]);
        const database = {
            select: () => ({ from: (table: unknown) => ({ where: () => ({ orderBy: async () => results.get(table) ?? [] }) }) }),
        } as unknown as typeof db;

        assert.deepEqual(await loadTheses(USER, database), { theses: [THESIS], dismissed: ["seed-meta"] });
    });
});
