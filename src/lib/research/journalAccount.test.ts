import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { JournalEntryInput } from '@/lib/validators/journal';

import { DEFAULT_JOURNAL_ENTRIES, type JournalEntry } from './journal';
import {
    JOURNAL_FULL_COPY_KEY,
    applyJournalWrite,
    fetchAccountJournal,
    importBrowserJournal,
    journalImportItems,
    mergeAccountJournal,
    sendJournalWrite,
    toJournalEntryInput,
    type AccountJournal,
    type JournalWrite,
} from './journalAccount';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const EXAMPLES = DEFAULT_JOURNAL_ENTRIES;
const NO_WRITES = new Map<string, JournalWrite>();

function input(id: string, extra: Partial<JournalEntryInput> = {}): JournalEntryInput {
    return {
        id, date: '2026-10-20', type: 'entry', ticker: 'NVDA', decision: 'Bought', rationale: 'Demand',
        outcome: 'pending', thesisId: null, dismissed: false, ...extra,
    };
}

const MINE = input('a1b2c3d4-0000-4000-8000-000000000001');
const OTHER = input('a1b2c3d4-0000-4000-8000-000000000002', { ticker: 'AMD' });

function ids(list: readonly JournalEntry[]) {
    return list.map((e) => e.id);
}

describe('mergeAccountJournal', () => {
    test('before anything has loaded, shows the examples', () => {
        assert.deepEqual(mergeAccountJournal(undefined, NO_WRITES, EXAMPLES), EXAMPLES);
    });

    test("the account's entries, then the examples it doesn't replace or dismiss", () => {
        const edited = input('seed-journal-1', { decision: 'Edited' });
        const merged = mergeAccountJournal({ entries: [MINE, edited], dismissed: ['seed-journal-2'] }, NO_WRITES, EXAMPLES);
        assert.deepEqual(ids(merged), [MINE.id, 'seed-journal-1', 'seed-journal-3', 'seed-journal-4']);
        assert.equal(merged[1].decision, 'Edited');
        // No thesis link is left out rather than null.
        assert.equal('thesisId' in merged[0], false);
        assert.equal(merged.find((e) => e.id === 'seed-journal-3')?.thesisId, 'seed-nvda');
    });

    test('unsaved writes show on top: new entries first, edits in place, deletions gone', () => {
        const pending = new Map<string, JournalWrite>([
            ['n-1', { kind: 'put', entry: input('n-1') }],
            [OTHER.id, { kind: 'put', entry: { ...OTHER, outcome: 'win' } }],
            ['n-2', { kind: 'put', entry: input('n-2') }],
            [MINE.id, { kind: 'put', entry: { ...MINE, dismissed: true } }],
            ['seed-journal-1', { kind: 'put', entry: input('seed-journal-1', { dismissed: true }) }],
        ]);
        const merged = mergeAccountJournal({ entries: [MINE, OTHER], dismissed: [] }, pending, EXAMPLES);
        assert.deepEqual(ids(merged), ['n-2', 'n-1', OTHER.id, 'seed-journal-2', 'seed-journal-3', 'seed-journal-4']);
        assert.equal(merged[2].outcome, 'win');
    });
});

describe('applyJournalWrite', () => {
    const stored: AccountJournal = { entries: [MINE, OTHER], dismissed: ['seed-journal-2'] };

    test('a new entry goes first; an edited one keeps its place', () => {
        assert.deepEqual(applyJournalWrite(stored, 'n-1', { kind: 'put', entry: input('n-1') }).entries.map((e) => e.id), ['n-1', MINE.id, OTHER.id]);
        const edited = applyJournalWrite(stored, MINE.id, { kind: 'put', entry: { ...MINE, outcome: 'loss' } });
        assert.deepEqual(edited.entries.map((e) => [e.id, e.outcome]), [[MINE.id, 'loss'], [OTHER.id, 'pending']]);
    });

    test("a deletion records the entry as dismissed, the user's own or an example; a save un-dismisses", () => {
        assert.deepEqual(applyJournalWrite(stored, OTHER.id, { kind: 'put', entry: { ...OTHER, dismissed: true } }), { entries: [MINE], dismissed: ['seed-journal-2', OTHER.id] });
        assert.deepEqual(
            applyJournalWrite(stored, 'seed-journal-1', { kind: 'put', entry: input('seed-journal-1', { dismissed: true }) }).dismissed,
            ['seed-journal-2', 'seed-journal-1'],
        );
        assert.deepEqual(applyJournalWrite(stored, 'seed-journal-2', { kind: 'put', entry: input('seed-journal-2') }).dismissed, []);
        assert.deepEqual(applyJournalWrite(undefined, MINE.id, { kind: 'put', entry: MINE }), { entries: [MINE], dismissed: [] });
    });
});

describe('toJournalEntryInput', () => {
    const entry: JournalEntry = { id: 'n-1', date: '2026-10-20', type: 'exit', ticker: ' tsla ', decision: ' Sold ', rationale: 'Took profits', outcome: 'win', thesisId: 'seed-tsla' };

    test('trims, keeps the thesis link, and is live unless dismissed', () => {
        assert.deepEqual(toJournalEntryInput(entry, { now: NOW }), {
            id: 'n-1', date: '2026-10-20', type: 'exit', ticker: 'tsla', decision: 'Sold', rationale: 'Took profits', outcome: 'win', thesisId: 'seed-tsla', dismissed: false,
        });
        assert.equal(toJournalEntryInput(entry, { now: NOW, dismissed: true })?.dismissed, true);
        assert.equal(toJournalEntryInput({ ...entry, thesisId: undefined }, { now: NOW })?.thesisId, null);
    });

    test('cuts text to the limits, dates an odd date today, and drops a thesis link it cannot store', () => {
        const long = toJournalEntryInput({ ...entry, decision: 'd'.repeat(600), rationale: 'r'.repeat(6000), ticker: 'T'.repeat(30), date: 'yesterday', thesisId: '../x' }, { now: NOW });
        assert.equal(long?.decision.length, 500);
        assert.equal(long?.rationale.length, 5000);
        assert.equal(long?.ticker.length, 20);
        assert.equal(long?.date, '2026-10-23');
        assert.equal(long?.thesisId, null);
    });

    test('null for an entry the API would refuse', () => {
        assert.equal(toJournalEntryInput({ ...entry, decision: '  ' }, { now: NOW }), null);
        assert.equal(toJournalEntryInput({ ...entry, id: 'Not An Id' }, { now: NOW }), null);
    });
});

describe('journalImportItems', () => {
    const mine: JournalEntry = { id: 'n-1', date: '2026-10-01', type: 'hold', ticker: 'AMD', decision: 'Held', rationale: 'Thesis intact', outcome: 'pending' };

    test("sends the user's entries and edited examples, dismisses deleted examples, skips untouched ones", () => {
        const local = [mine, { ...EXAMPLES[0], outcome: 'win' as const }, EXAMPLES[1], EXAMPLES[3]];
        const { items, shortened } = journalImportItems(local, EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => [i.id, i.dismissed]), [['n-1', false], ['seed-journal-1', false], ['seed-journal-3', true]]);
        assert.equal(items[1].outcome, 'win');
        assert.equal(shortened, false);
    });

    test('an empty journal sends nothing: the browser showed the examples again', () => {
        assert.deepEqual(journalImportItems([], EXAMPLES, NOW), { items: [], shortened: false });
        assert.deepEqual(journalImportItems(EXAMPLES, EXAMPLES, NOW), { items: [], shortened: false });
    });

    test('skips repeated ids and entries the API would refuse', () => {
        const { items, shortened } = journalImportItems([mine, { ...mine, decision: 'again' }, { ...mine, id: 'n-2', decision: '' }, ...EXAMPLES], EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => [i.id, i.decision]), [['n-1', 'Held']]);
        // The refused entry is reported, so the browser keeps its copy.
        assert.equal(shortened, true);
    });

    test('says when text was longer than the account keeps', () => {
        for (const long of [{ decision: 'd'.repeat(501) }, { rationale: 'r'.repeat(5001) }, { ticker: 'T'.repeat(21) }]) {
            assert.equal(journalImportItems([{ ...mine, ...long }, ...EXAMPLES], EXAMPLES, NOW).shortened, true, Object.keys(long)[0]);
        }
        assert.equal(journalImportItems([{ ...mine, rationale: 'r'.repeat(5000) }, ...EXAMPLES], EXAMPLES, NOW).shortened, false);
    });
});

describe('requests', () => {
    test('loads the account journal and sends writes to the entry path', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const fetchImpl = (async (url: string, init: RequestInit = {}) => {
            calls.push({ url, init });
            return url.endsWith('/journal') ? Response.json({ data: { entries: [MINE], dismissed: ['seed-journal-1'] } }) : new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        assert.deepEqual(await fetchAccountJournal(fetchImpl), { entries: [MINE], dismissed: ['seed-journal-1'] });
        const order = { session: 'page-0001', seq: 1 };
        await sendJournalWrite(MINE.id, { kind: 'put', entry: MINE }, order, fetchImpl);
        const deleted = input('seed-journal-1', { dismissed: true });
        await sendJournalWrite('seed-journal-1', { kind: 'put', entry: deleted }, { ...order, seq: 2 }, fetchImpl);
        assert.deepEqual(calls.map((c) => [c.init.method ?? 'GET', c.url]), [
            ['GET', '/api/research/journal'],
            ['PUT', `/api/research/journal/${MINE.id}`],
            ['PUT', '/api/research/journal/seed-journal-1'],
        ]);
        assert.deepEqual(JSON.parse(String(calls[1].init.body)), { entry: MINE, order });
        assert.deepEqual(JSON.parse(String(calls[2].init.body)), { entry: deleted, order: { ...order, seq: 2 } });
    });
});

describe('importBrowserJournal', () => {
    function storageWith(key: string, entries: unknown) {
        const map = new Map<string, string>([[key, JSON.stringify({ version: 1, entries })]]);
        return {
            map,
            storage: {
                getItem: (k: string) => map.get(k) ?? null,
                setItem: (k: string, v: string) => void map.set(k, v),
                removeItem: (k: string) => void map.delete(k),
            },
        };
    }
    const mine: JournalEntry = { id: 'n-1', date: '2026-10-01', type: 'hold', ticker: 'AMD', decision: 'Held', rationale: 'Thesis intact', outcome: 'pending' };

    test("sends this browser's journal once, then removes the browser's copy", async () => {
        const { map, storage } = storageWith('atlas:research:journal:user-1', [mine, ...EXAMPLES]);
        const bodies: unknown[] = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            assert.equal(url, '/api/research/journal/import');
            bodies.push(JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        await Promise.all([
            importBrowserJournal('user-1', { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
            importBrowserJournal('user-1', { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
        ]);
        assert.equal(bodies.length, 1);
        assert.deepEqual((bodies[0] as { items: unknown }).items, [toJournalEntryInput(mine, { now: NOW })]);
        assert.equal(map.has('atlas:research:journal:user-1'), false);
    });

    test('text the account cut short stays in this browser, and the user is told once', async () => {
        const long = { ...mine, rationale: 'r'.repeat(6000) };
        const { map, storage } = storageWith('atlas:research:journal:user-6', [long]);
        let told = 0;
        const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
        await importBrowserJournal('user-6', { storage, examples: EXAMPLES, now: NOW, fetchImpl, onShortened: () => { told += 1; } });
        await importBrowserJournal('user-6', { storage, examples: EXAMPLES, now: NOW, fetchImpl, onShortened: () => { told += 1; } });
        assert.equal(told, 1);
        assert.equal(map.has('atlas:research:journal:user-6'), false);
        assert.deepEqual(JSON.parse(map.get(`${JOURNAL_FULL_COPY_KEY}:user-6`) ?? 'null'), { version: 1, entries: [long] });
    });

    test('keeps the copy when the send fails', async () => {
        const { map, storage } = storageWith('atlas:research:journal:user-2', [mine]);
        const fetchImpl = (async () => Response.json({ code: 'JOURNAL_IMPORT_FAILED' }, { status: 500 })) as unknown as typeof fetch;
        await assert.rejects(importBrowserJournal('user-2', { storage, examples: EXAMPLES, now: NOW, fetchImpl }));
        assert.equal(map.has('atlas:research:journal:user-2'), true);
    });

    test('a journal saved under the old shared key is the signed-in user\'s', async () => {
        const { map, storage } = storageWith('atlas:research:journal', [mine]);
        let sent = 0;
        const fetchImpl = (async () => { sent += 1; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
        await importBrowserJournal('user-3', { storage, examples: EXAMPLES, now: NOW, fetchImpl });
        assert.equal(sent, 1);
        assert.equal(map.size, 0);
    });
});
