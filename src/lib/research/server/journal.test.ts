import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import type { JournalEntryInput } from "@/lib/validators/journal";

import {
    buildImportJournalQuery,
    buildListJournalQuery,
    buildSaveJournalEntryQuery,
    importJournal,
    loadJournal,
} from "./journal";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-10-23T08:00:00.000Z");
const ORDER = { session: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", seq: 7 };

const ENTRY: JournalEntryInput = {
    id: "3f1c2b9e-8d4a-4f6b-9c1e-2a7d5e8f0b13",
    date: "2026-10-23",
    type: "entry",
    ticker: "NVDA",
    decision: "Opened a position",
    rationale: "Data-centre demand",
    outcome: "pending",
    thesisId: "seed-nvda",
    dismissed: false,
};

describe("journal queries", () => {
    test("list reads one user's entries, newest date first", () => {
        const { sql, params } = buildListJournalQuery(USER).toSQL();
        assert.match(sql, /from "journal_entries" where "journal_entries"\."user_id" = \$1 order by "journal_entries"\."date" desc, "journal_entries"\."created_at" desc, "journal_entries"\."id" asc/i);
        assert.deepEqual(params, [USER]);
    });

    test("save adds the entry or replaces the user's entry with that id, keeping its created time", () => {
        const { sql, params } = buildSaveJournalEntryQuery(USER, ENTRY, ORDER, NOW).toSQL();
        assert.match(sql, /insert into "journal_entries" \("user_id", "id", "date", "type", "ticker", "decision", "rationale", "outcome", "thesis_id", "dismissed", "write_session", "write_seq", "created_at", "updated_at"\)/i);
        assert.match(sql, /on conflict \("user_id","id"\) do update set "date" = \$\d+, "type" = \$\d+, "ticker" = \$\d+, "decision" = \$\d+, "rationale" = \$\d+, "outcome" = \$\d+, "thesis_id" = \$\d+, "dismissed" = \$\d+, "write_session" = \$\d+, "write_seq" = \$\d+, "updated_at" = \$\d+ where \("journal_entries"\."write_session" is distinct from \$\d+ or "journal_entries"\."write_seq" < \$\d+\)$/i);
        assert.equal(params[0], USER);
        assert.equal(params[1], ENTRY.id);
        assert.ok(params.includes("seed-nvda"));
    });

    test("a deletion keeps the entry, its text cleared, so a late save can't bring it back", () => {
        const { sql, params } = buildSaveJournalEntryQuery(USER, { ...ENTRY, dismissed: true }, ORDER, NOW).toSQL();
        assert.match(sql, /^insert into "journal_entries"/i);
        assert.match(sql, /where \("journal_entries"\."write_session" is distinct from \$\d+ or "journal_entries"\."write_seq" < \$\d+\)$/i);
        assert.ok(params.includes(true));
        assert.ok(params.includes(ENTRY.ticker));
        for (const text of [ENTRY.decision, ENTRY.rationale, ENTRY.thesisId]) assert.ok(!params.includes(text), String(text));
    });

    test("import keeps the browser's order and leaves entries the user already has", () => {
        const second = { ...ENTRY, id: "seed-journal-2", thesisId: null };
        const { sql, params } = buildImportJournalQuery(USER, { items: [ENTRY, second] }, NOW).toSQL();
        assert.match(sql, /on conflict do nothing$/i);
        assert.ok(params.includes(NOW.toISOString()));
        assert.ok(params.includes(new Date(NOW.getTime() - 1).toISOString()));
        assert.ok(params.indexOf(ENTRY.id) < params.indexOf(second.id));
    });
});

describe("importing in batches", () => {
    test("a later batch continues the first one's order", () => {
        const startedAt = NOW.getTime() - 5_000;
        const { params } = buildImportJournalQuery(USER, { items: [ENTRY], first: 500, startedAt }, new Date(NOW.getTime() + 2_000)).toSQL();
        assert.ok(params.includes(new Date(startedAt - 500).toISOString()));
        const ahead = buildImportJournalQuery(USER, { items: [ENTRY], startedAt: NOW.getTime() + 60_000 }, NOW).toSQL();
        assert.ok(ahead.params.includes(NOW.toISOString()));
    });
});

describe("loadJournal", () => {
    test("separates the user's entries from the examples they deleted", async () => {
        const dismissed = { ...ENTRY, id: "seed-journal-2", dismissed: true };
        const rows = [ENTRY, dismissed].map((entry) => ({ userId: USER, ...entry, createdAt: NOW, updatedAt: NOW }));
        const database = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) } as unknown as typeof db;

        assert.deepEqual(await loadJournal(USER, database), { entries: [ENTRY], dismissed: ["seed-journal-2"] });
    });
});

describe("importJournal", () => {
    test("writes nothing for an empty journal", async () => {
        const database = { insert: () => assert.fail("nothing to insert") } as unknown as typeof db;
        await importJournal(USER, { items: [] }, { database });
    });
});
