import { THESIS_IMPORT_MAX, THESIS_LIMITS, thesisSchema, type ThesisInput } from '@/lib/validators/thesis';
import type { WriteOrder } from '@/lib/validators/research-ids';
import { removeUserValue, writeUserValue } from '@/lib/storage/user-scope';

import { accountRequest, importInBatches, importOnce, sendRecordWrite, type Fetch } from './accountWrites';
import type { StoredTheses } from './server/theses';
import { THESIS_STORAGE_KEY, loadThesesFromStorage } from './storage';
import type { Thesis, ThesisCatalyst, ThesisEvidence } from './thesis';

/**
 * Theses in the user's account (launch item i38), for `useThesisStore` when
 * the app has a database. As with the watchlist and journal: the account's
 * theses with this page's unsaved writes on top, then the example theses
 * the user hasn't edited or deleted; a deleted thesis is saved as
 * `dismissed`. Theses this browser kept before are sent once, then removed
 * from the browser.
 */

export type AccountTheses = StoredTheses;

/** One save, the thesis whole. Deleting a thesis saves it with `dismissed: true`. */
export type ThesisWrite = { kind: 'put'; thesis: ThesisInput };

function toThesis(input: ThesisInput): Thesis {
    return {
        id: input.id,
        ticker: input.ticker,
        companyName: input.companyName,
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        conviction: input.conviction,
        targetPrice: input.targetPrice,
        currentPrice: input.currentPrice ?? undefined,
        timeHorizon: input.timeHorizon,
        dateCreated: input.dateCreated,
        dateUpdated: input.dateUpdated,
        tags: [...input.tags],
        hypothesis: input.hypothesis,
        bullCase: [...input.bullCase],
        bearCase: [...input.bearCase],
        catalysts: input.catalysts.map((c) => ({ ...c })),
        linkedEvidence: input.linkedEvidence.map((e): ThesisEvidence => {
            const evidence: ThesisEvidence = { id: e.id, title: e.title, type: e.type, date: e.date };
            if (e.url) evidence.url = e.url;
            return evidence;
        }),
        healthScore: input.healthScore,
    };
}

/** The theses to show: new unsaved ones, the account's, then examples. */
export function mergeAccountTheses(
    stored: AccountTheses | undefined,
    pending: ReadonlyMap<string, ThesisWrite>,
    examples: readonly Thesis[],
): Thesis[] {
    const rows = new Map<string, ThesisInput>();
    for (const thesis of stored?.theses ?? []) rows.set(thesis.id, thesis);
    const dismissed = new Set(stored?.dismissed ?? []);
    const added: ThesisInput[] = [];
    for (const [id, write] of pending) {
        if (write.thesis.dismissed) {
            rows.delete(id);
            dismissed.add(id);
            continue;
        }
        dismissed.delete(id);
        if (rows.has(id)) rows.set(id, write.thesis);
        else added.unshift(write.thesis);
    }
    const own = [...added, ...rows.values()].map(toThesis);
    const ids = new Set(own.map((thesis) => thesis.id));
    return [...own, ...examples.filter((example) => !ids.has(example.id) && !dismissed.has(example.id))];
}

/** The account's theses once `write` is saved. */
export function applyThesisWrite(stored: AccountTheses | undefined, id: string, write: ThesisWrite): AccountTheses {
    const list = (stored?.theses ?? []).filter((thesis) => thesis.id !== id);
    const dismissed = (stored?.dismissed ?? []).filter((d) => d !== id);
    if (write.thesis.dismissed) return { theses: list, dismissed: [...dismissed, id] };
    const index = stored?.theses.findIndex((thesis) => thesis.id === id) ?? -1;
    if (index < 0) return { theses: [write.thesis, ...list], dismissed };
    list.splice(index, 0, write.thesis);
    return { theses: list, dismissed };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const THESIS_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;

function isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

/**
 * `thesis` as the API takes it: text and lists cut to the limits, empty
 * tags and case items dropped, catalysts and evidence the API can't store
 * dropped (no title, a repeated or unusable id), a link that isn't http(s)
 * dropped, odd dates made today. Sets `report.shortened` when anything was
 * cut or dropped. Null for a thesis the API would refuse anyway.
 */
export function toThesisInput(
    thesis: Thesis,
    { now, dismissed = false, report }: { now: number; dismissed?: boolean; report?: { shortened: boolean } },
): ThesisInput | null {
    const cut = (value: string, max: number) => {
        const trimmed = value.trim();
        if (trimmed.length > max) {
            if (report) report.shortened = true;
            return trimmed.slice(0, max);
        }
        return trimmed;
    };
    const list = <T,>(items: readonly T[], max: number) => {
        if (items.length > max && report) report.shortened = true;
        return items.slice(0, max);
    };
    const drop = () => {
        if (report) report.shortened = true;
        return false;
    };
    const texts = (items: readonly string[], maxItems: number, maxLength: number) =>
        list(items.map((item) => cut(item, maxLength)).filter((item) => item.length > 0), maxItems);

    const catalystIds = new Set<string>();
    const catalysts = list(thesis.catalysts.filter((c: ThesisCatalyst) => {
        if (!THESIS_ID.test(c.id) || catalystIds.has(c.id) || !c.title.trim()) return drop();
        catalystIds.add(c.id);
        return true;
    }), THESIS_LIMITS.catalysts).map((c) => ({
        id: c.id,
        title: cut(c.title, THESIS_LIMITS.itemTitle),
        date: cut(c.date, THESIS_LIMITS.itemDate),
        impact: c.impact,
    }));
    const evidenceIds = new Set<string>();
    const linkedEvidence = list(thesis.linkedEvidence.filter((e: ThesisEvidence) => {
        if (!THESIS_ID.test(e.id) || evidenceIds.has(e.id) || !e.title.trim()) return drop();
        evidenceIds.add(e.id);
        return true;
    }), THESIS_LIMITS.evidence).map((e) => {
        const url = e.url?.trim() ?? '';
        const usable = url.length > 0 && url.length <= THESIS_LIMITS.url && isHttpUrl(url);
        if (url && !usable) drop();
        return {
            id: e.id,
            title: cut(e.title, THESIS_LIMITS.itemTitle),
            type: e.type,
            date: cut(e.date, THESIS_LIMITS.itemDate),
            url: usable ? url : null,
        };
    });
    const today = isoDate(now);

    const parsed = thesisSchema.safeParse({
        id: thesis.id,
        ticker: cut(thesis.ticker, THESIS_LIMITS.ticker),
        companyName: cut(thesis.companyName, THESIS_LIMITS.companyName),
        title: cut(thesis.title, THESIS_LIMITS.title),
        description: cut(thesis.description, THESIS_LIMITS.description),
        type: thesis.type,
        status: thesis.status,
        conviction: thesis.conviction,
        targetPrice: Number.isFinite(thesis.targetPrice) && thesis.targetPrice >= 0 ? thesis.targetPrice : 0,
        currentPrice: thesis.currentPrice != null && Number.isFinite(thesis.currentPrice) && thesis.currentPrice >= 0 ? thesis.currentPrice : null,
        timeHorizon: cut(thesis.timeHorizon, THESIS_LIMITS.timeHorizon),
        dateCreated: ISO_DATE.test(thesis.dateCreated) ? thesis.dateCreated : today,
        dateUpdated: ISO_DATE.test(thesis.dateUpdated) ? thesis.dateUpdated : today,
        tags: texts(thesis.tags, THESIS_LIMITS.tags, THESIS_LIMITS.tag),
        hypothesis: cut(thesis.hypothesis, THESIS_LIMITS.hypothesis),
        bullCase: texts(thesis.bullCase, THESIS_LIMITS.cases, THESIS_LIMITS.caseItem),
        bearCase: texts(thesis.bearCase, THESIS_LIMITS.cases, THESIS_LIMITS.caseItem),
        catalysts,
        linkedEvidence,
        healthScore: Number.isFinite(thesis.healthScore) ? Math.min(100, Math.max(0, Math.round(thesis.healthScore))) : 50,
        dismissed,
    });
    return parsed.success ? parsed.data : null;
}

/** The thesis with its dates taken out: example theses are dated from the day they were shown. */
function withoutDates(thesis: Thesis) {
    return JSON.stringify({
        ...thesis,
        dateCreated: undefined,
        dateUpdated: undefined,
        catalysts: thesis.catalysts.map((c) => ({ ...c, date: undefined })),
        linkedEvidence: thesis.linkedEvidence.map((e) => ({ ...e, date: undefined })),
    });
}

/**
 * What to send from theses this browser kept: the user's own (edited
 * examples included) and a dismissal for each example they deleted.
 * Examples that only differ by their dates need nothing, and an empty list
 * sends nothing: the browser showed the examples again then.
 */
export function thesisImportItems(
    local: readonly Thesis[],
    examples: readonly Thesis[],
    now: number,
): { items: ThesisInput[]; shortened: boolean } {
    if (local.length === 0) return { items: [], shortened: false };
    const byId = new Map(examples.map((example) => [example.id, example]));
    const seen = new Set<string>();
    const report = { shortened: false };
    const own = local.flatMap((thesis) => {
        if (seen.has(thesis.id)) return [];
        seen.add(thesis.id);
        const example = byId.get(thesis.id);
        if (example && withoutDates(thesis) === withoutDates(example)) return [];
        const input = toThesisInput(thesis, { now, report });
        if (!input) report.shortened = true;
        return input ? [input] : [];
    });
    const removed = examples.flatMap((example) => {
        if (seen.has(example.id)) return [];
        const input = toThesisInput(example, { now, dismissed: true });
        return input ? [input] : [];
    });
    return { items: [...own, ...removed], shortened: report.shortened };
}

/** Where this browser keeps its full theses when the account couldn't take all of their text. */
export const THESES_FULL_COPY_KEY = `${THESIS_STORAGE_KEY}-full-copy`;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function fetchAccountTheses(fetchImpl: Fetch = fetch): Promise<AccountTheses> {
    const response = await accountRequest(fetchImpl, '/api/research/theses');
    const body = (await response.json()) as { data?: Partial<AccountTheses> };
    return {
        theses: Array.isArray(body.data?.theses) ? body.data.theses : [],
        dismissed: Array.isArray(body.data?.dismissed) ? body.data.dismissed : [],
    };
}

export async function sendThesisWrite(id: string, write: ThesisWrite, order: WriteOrder, fetchImpl: Fetch = fetch): Promise<void> {
    await sendRecordWrite(fetchImpl, `/api/research/theses/${encodeURIComponent(id)}`,
        { kind: 'put', body: { thesis: write.thesis } }, order);
}

/**
 * Sends the theses this browser kept for the user in `scope` to the
 * account, once per page load, then removes the browser's copy. A failed
 * send keeps the copy, and the next call tries again; the account keeps
 * theses it already has. Text the account had to shorten stays in this
 * browser under a key of its own.
 */
export function importBrowserTheses(
    scope: string,
    {
        storage,
        examples,
        now,
        fetchImpl = fetch,
        onShortened,
    }: {
        storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
        examples: readonly Thesis[];
        now: number;
        fetchImpl?: Fetch;
        /** Called once when some text was longer than the account keeps. */
        onShortened?: () => void;
    },
): Promise<void> {
    return importOnce(`${THESIS_STORAGE_KEY}:${scope}`, async () => {
        const local = loadThesesFromStorage(storage, scope);
        if (!local) return;
        const { items, shortened } = thesisImportItems(local, examples, now);
        await importInBatches(fetchImpl, '/api/research/theses/import', items, THESIS_IMPORT_MAX);
        // The browser's theses go only once their full text is kept: if the
        // copy can't be written (a full quota), they stay, and the next load
        // tries again.
        const kept = !shortened || writeUserValue(storage, THESES_FULL_COPY_KEY, JSON.stringify({ version: 2, theses: local }), scope);
        if (kept) removeUserValue(storage, THESIS_STORAGE_KEY, scope);
        if (shortened) onShortened?.();
    });
}
