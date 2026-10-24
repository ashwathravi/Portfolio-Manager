import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ThesisInput } from '@/lib/validators/thesis';

import { getDefaultTheses, rebaseSeedTheses, type Thesis } from './thesis';
import {
    THESES_FULL_COPY_KEY,
    applyThesisWrite,
    fetchAccountTheses,
    importBrowserTheses,
    mergeAccountTheses,
    sendThesisWrite,
    thesisImportItems,
    toThesisInput,
    type AccountTheses,
    type ThesisWrite,
} from './thesisAccount';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const EXAMPLES = getDefaultTheses(NOW);
const NO_WRITES = new Map<string, ThesisWrite>();

const MINE: Thesis = {
    id: 'b2c1a0f4-0d7e-4c55-9e1b-5c2c3e7a8f90',
    ticker: 'AMD',
    companyName: 'Advanced Micro Devices',
    title: 'MI300 share gains',
    description: 'Second source for AI accelerators',
    type: 'bull',
    status: 'active',
    conviction: 'MEDIUM',
    targetPrice: 200,
    timeHorizon: '12 months',
    dateCreated: '2026-10-01',
    dateUpdated: '2026-10-20',
    tags: ['AI'],
    hypothesis: '',
    bullCase: [],
    bearCase: [],
    catalysts: [{ id: 'cat-a', title: 'Earnings', date: 'Q1 2027', impact: 'high' }],
    linkedEvidence: [{ id: 'ev-a', title: 'Teardown', type: 'report', date: '2026-10-02', url: 'https://example.com/a' }],
    healthScore: 60,
};

function input(thesis: Thesis, extra: Partial<ThesisInput> = {}): ThesisInput {
    const value = toThesisInput(thesis, { now: NOW });
    assert.ok(value);
    return { ...value, ...extra };
}

function ids(list: readonly Thesis[]) {
    return list.map((t) => t.id);
}

describe('mergeAccountTheses', () => {
    test('before anything has loaded, shows the examples', () => {
        assert.deepEqual(mergeAccountTheses(undefined, NO_WRITES, EXAMPLES), EXAMPLES);
    });

    test("the account's theses, then examples it doesn't replace or dismiss", () => {
        const editedNvda = input(EXAMPLES[0], { title: 'Mine now' });
        const stored: AccountTheses = { theses: [input(MINE), editedNvda], dismissed: ['seed-meta'] };
        const merged = mergeAccountTheses(stored, NO_WRITES, EXAMPLES);
        assert.deepEqual(ids(merged), [MINE.id, 'seed-nvda', ...EXAMPLES.slice(1).map((t) => t.id).filter((id) => id !== 'seed-meta')]);
        assert.equal(merged[1].title, 'Mine now');
        // Back to the app's shape: no null price or link.
        assert.equal('currentPrice' in merged[0] ? merged[0].currentPrice : undefined, undefined);
        assert.equal(merged[0].linkedEvidence[0].url, 'https://example.com/a');
    });

    test('unsaved writes show on top: new theses first, edits in place, deletions gone', () => {
        const other = { ...MINE, id: 'c3d2b1a0-0000-4000-8000-000000000002', ticker: 'INTC' };
        const pending = new Map<string, ThesisWrite>([
            ['new-1', { kind: 'put', thesis: input({ ...MINE, id: 'new-1' }) }],
            [MINE.id, { kind: 'put', thesis: input(MINE, { conviction: 'HIGH' }) }],
            [other.id, { kind: 'put', thesis: input(other, { dismissed: true }) }],
        ]);
        const merged = mergeAccountTheses({ theses: [input(MINE), input(other)], dismissed: [] }, pending, []);
        assert.deepEqual(ids(merged), ['new-1', MINE.id]);
        assert.equal(merged[1].conviction, 'HIGH');
    });
});

describe('applyThesisWrite', () => {
    const stored: AccountTheses = { theses: [input(MINE)], dismissed: ['seed-meta'] };

    test('a new thesis goes first, an edit keeps its place, a deletion is recorded', () => {
        const added = input({ ...MINE, id: 'new-1' });
        assert.deepEqual(applyThesisWrite(stored, 'new-1', { kind: 'put', thesis: added }).theses.map((t) => t.id), ['new-1', MINE.id]);
        assert.equal(applyThesisWrite(stored, MINE.id, { kind: 'put', thesis: input(MINE, { title: 'x' }) }).theses[0].title, 'x');
        assert.deepEqual(applyThesisWrite(stored, MINE.id, { kind: 'put', thesis: input(MINE, { dismissed: true }) }), { theses: [], dismissed: ['seed-meta', MINE.id] });
        assert.deepEqual(applyThesisWrite(stored, 'seed-meta', { kind: 'put', thesis: input(EXAMPLES.find((t) => t.id === 'seed-meta')!) }).dismissed, []);
    });
});

describe('toThesisInput', () => {
    test('maps the app shape to the API shape', () => {
        const value = toThesisInput({ ...MINE, currentPrice: 150 }, { now: NOW });
        assert.equal(value?.currentPrice, 150);
        assert.equal(toThesisInput(MINE, { now: NOW })?.currentPrice, null);
        assert.equal(toThesisInput({ ...MINE, linkedEvidence: [{ ...MINE.linkedEvidence[0], url: undefined }] }, { now: NOW })?.linkedEvidence[0].url, null);
        assert.equal(toThesisInput(MINE, { now: NOW, dismissed: true })?.dismissed, true);
    });

    test('cuts what is too long and drops what the API cannot store, saying so', () => {
        const report = { shortened: false };
        const value = toThesisInput({
            ...MINE,
            title: 't'.repeat(300),
            tags: ['', 'AI', ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
            catalysts: [
                { id: 'cat-a', title: 'Earnings', date: 'Q1 2027', impact: 'high' },
                { id: 'cat-a', title: 'Again', date: '', impact: 'low' },
                { id: 'Bad Id', title: 'Odd', date: '', impact: 'low' },
                { id: 'cat-b', title: '  ', date: '', impact: 'low' },
            ],
            linkedEvidence: [{ ...MINE.linkedEvidence[0], url: 'javascript:alert(1)' }],
            dateCreated: '',
        }, { now: NOW, report });
        assert.ok(value);
        assert.equal(value.title.length, 200);
        assert.equal(value.tags.length, 20);
        assert.deepEqual(value.catalysts.map((c) => c.id), ['cat-a']);
        assert.equal(value.linkedEvidence[0].url, null);
        assert.equal(value.dateCreated, '2026-10-23');
        assert.equal(report.shortened, true);

        const clean = { shortened: false };
        toThesisInput(MINE, { now: NOW, report: clean });
        assert.equal(clean.shortened, false);
    });

    test('null for a thesis the API would refuse', () => {
        assert.equal(toThesisInput({ ...MINE, title: ' ' }, { now: NOW }), null);
        assert.equal(toThesisInput({ ...MINE, id: 'Not An Id' }, { now: NOW }), null);
    });
});

describe('thesisImportItems', () => {
    test("sends the user's theses and edited examples, dismisses deleted examples, skips untouched ones", () => {
        // As a browser stored the examples on an earlier day: same theses, other dates.
        const storedExamples = rebaseSeedTheses(EXAMPLES, NOW - 40 * 86_400_000);
        const [nvda, ...rest] = storedExamples;
        const local = [MINE, { ...nvda, conviction: 'LOW' as const }, ...rest.slice(1)];
        const { items, shortened } = thesisImportItems(local, EXAMPLES, NOW);
        assert.deepEqual(items.map((t) => [t.id, t.dismissed]), [[MINE.id, false], ['seed-nvda', false], [rest[0].id, true]]);
        assert.equal(items[1].conviction, 'LOW');
        assert.equal(shortened, false);
    });

    test('an empty list sends nothing: the browser showed the examples again', () => {
        assert.deepEqual(thesisImportItems([], EXAMPLES, NOW), { items: [], shortened: false });
        assert.deepEqual(thesisImportItems(EXAMPLES, EXAMPLES, NOW), { items: [], shortened: false });
    });

    test('says when text was longer than the account keeps, or a thesis could not be stored', () => {
        assert.equal(thesisImportItems([{ ...MINE, description: 'd'.repeat(6000) }, ...EXAMPLES], EXAMPLES, NOW).shortened, true);
        assert.equal(thesisImportItems([{ ...MINE, title: '' }, ...EXAMPLES], EXAMPLES, NOW).shortened, true);
    });
});

describe('requests', () => {
    test('loads the account theses and saves one with its order', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const fetchImpl = (async (url: string, init: RequestInit = {}) => {
            calls.push({ url, init });
            return url.endsWith('/theses') ? Response.json({ data: { theses: [input(MINE)], dismissed: ['seed-meta'] } }) : new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        assert.deepEqual(await fetchAccountTheses(fetchImpl), { theses: [input(MINE)], dismissed: ['seed-meta'] });
        const order = { session: 'page-0001', seq: 4 };
        await sendThesisWrite(MINE.id, { kind: 'put', thesis: input(MINE) }, order, fetchImpl);
        assert.equal(calls[1].url, `/api/research/theses/${MINE.id}`);
        assert.equal(calls[1].init.method, 'PUT');
        assert.equal(calls[1].init.keepalive, true);
        assert.deepEqual(JSON.parse(String(calls[1].init.body)), { thesis: input(MINE), order });
    });
});

describe('importBrowserTheses', () => {
    function storageWith(key: string, theses: unknown) {
        const map = new Map<string, string>([[key, JSON.stringify({ version: 2, theses })]]);
        return {
            map,
            storage: {
                getItem: (k: string) => map.get(k) ?? null,
                setItem: (k: string, v: string) => void map.set(k, v),
                removeItem: (k: string) => void map.delete(k),
            },
        };
    }

    test("sends this browser's theses once, then removes the browser's copy", async () => {
        const { map, storage } = storageWith('atlas:research:theses:user-1', [MINE, ...EXAMPLES]);
        const bodies: { items: ThesisInput[] }[] = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            assert.equal(url, '/api/research/theses/import');
            bodies.push(JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;
        await Promise.all([
            importBrowserTheses('user-1', { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
            importBrowserTheses('user-1', { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
        ]);
        assert.equal(bodies.length, 1);
        assert.deepEqual(bodies[0].items.map((t) => t.id), [MINE.id]);
        assert.equal(map.size, 0);
    });

    test('text the account cut short stays in this browser, and the user is told once', async () => {
        const long = { ...MINE, hypothesis: 'h'.repeat(6000) };
        const { map, storage } = storageWith('atlas:research:theses:user-2', [long]);
        let told = 0;
        const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
        await importBrowserTheses('user-2', { storage, examples: EXAMPLES, now: NOW, fetchImpl, onShortened: () => { told += 1; } });
        assert.equal(told, 1);
        assert.equal(map.has('atlas:research:theses:user-2'), false);
        assert.equal(JSON.parse(map.get(`${THESES_FULL_COPY_KEY}:user-2`) ?? 'null').theses[0].hypothesis.length, 6000);
    });

    test('keeps the theses when their full-text copy cannot be stored', async () => {
        const long = { ...MINE, hypothesis: 'h'.repeat(6000) };
        const { map, storage } = storageWith('atlas:research:theses:user-4', [long]);
        const full = {
            ...storage,
            setItem: (k: string, v: string) => {
                if (k.includes('full-copy')) throw new Error('QuotaExceededError');
                storage.setItem(k, v);
            },
        };
        const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
        await importBrowserTheses('user-4', { storage: full, examples: EXAMPLES, now: NOW, fetchImpl });
        assert.equal(map.has('atlas:research:theses:user-4'), true);
        assert.equal(map.has(`${THESES_FULL_COPY_KEY}:user-4`), false);
    });

    test('keeps the copy when the send fails', async () => {
        const { map, storage } = storageWith('atlas:research:theses:user-3', [MINE]);
        const fetchImpl = (async () => Response.json({ code: 'THESIS_IMPORT_FAILED' }, { status: 500 })) as unknown as typeof fetch;
        await assert.rejects(importBrowserTheses('user-3', { storage, examples: EXAMPLES, now: NOW, fetchImpl }));
        assert.equal(map.has('atlas:research:theses:user-3'), true);
    });
});
