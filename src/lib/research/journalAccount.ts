import {
    JOURNAL_ENTRY_LIMITS,
    JOURNAL_IMPORT_MAX_ENTRIES,
    journalEntrySchema,
    type JournalEntryInput,
} from '@/lib/validators/journal';
import type { WriteOrder } from '@/lib/validators/research-ids';
import { removeUserValue, writeUserValue } from '@/lib/storage/user-scope';

import { accountRequest, importInBatches, importOnce, sendRecordWrite, type Fetch } from './accountWrites';
import type { JournalEntry } from './journal';
import { JOURNAL_STORAGE_KEY, loadJournalFromStorage } from './journalStorage';
import type { StoredJournal } from './server/journal';

/**
 * The decision journal in the user's account (launch item i38), for
 * `useJournalStore` when the app has a database. As with the watchlist
 * (`watchlistAccount.ts`): the account's entries with this page's unsaved
 * writes on top, then the example entries the user hasn't edited or
 * deleted; a deleted entry is saved as `dismissed`, so a deleted example
 * stays gone and a late save can't bring the user's own back. A journal this
 * browser kept before is sent once, then removed from the browser.
 */

export type AccountJournal = StoredJournal;

/** One save. Deleting an entry saves it with `dismissed: true`. */
export type JournalWrite = { kind: 'put'; entry: JournalEntryInput };

function toJournalEntry(input: JournalEntryInput): JournalEntry {
    const entry: JournalEntry = {
        id: input.id,
        date: input.date,
        type: input.type,
        ticker: input.ticker,
        decision: input.decision,
        rationale: input.rationale,
        outcome: input.outcome,
    };
    if (input.thesisId) entry.thesisId = input.thesisId;
    return entry;
}

/** The journal to show (unsorted): new unsaved entries, the account's, then examples. */
export function mergeAccountJournal(
    stored: AccountJournal | undefined,
    pending: ReadonlyMap<string, JournalWrite>,
    examples: readonly JournalEntry[],
): JournalEntry[] {
    const rows = new Map<string, JournalEntryInput>();
    for (const entry of stored?.entries ?? []) rows.set(entry.id, entry);
    const dismissed = new Set(stored?.dismissed ?? []);
    const added: JournalEntryInput[] = [];
    for (const [id, write] of pending) {
        if (write.entry.dismissed) {
            rows.delete(id);
            dismissed.add(id);
            continue;
        }
        dismissed.delete(id);
        if (rows.has(id)) rows.set(id, write.entry);
        else added.unshift(write.entry);
    }
    const own = [...added, ...rows.values()].map(toJournalEntry);
    const ids = new Set(own.map((entry) => entry.id));
    return [...own, ...examples.filter((example) => !ids.has(example.id) && !dismissed.has(example.id))];
}

/** The account's journal once `write` is saved. */
export function applyJournalWrite(stored: AccountJournal | undefined, id: string, write: JournalWrite): AccountJournal {
    const entries = (stored?.entries ?? []).filter((entry) => entry.id !== id);
    const dismissed = (stored?.dismissed ?? []).filter((d) => d !== id);
    if (write.entry.dismissed) return { entries, dismissed: [...dismissed, id] };
    const index = stored?.entries.findIndex((entry) => entry.id === id) ?? -1;
    if (index < 0) return { entries: [write.entry, ...entries], dismissed };
    entries.splice(index, 0, write.entry);
    return { entries, dismissed };
}

function isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * `entry` as the API takes it: text cut to the limits, a missing or odd
 * date made today, a thesis link the API can't store dropped. Null for an
 * entry the API would refuse anyway (no decision, say).
 */
export function toJournalEntryInput(entry: JournalEntry, { now, dismissed = false }: { now: number; dismissed?: boolean }): JournalEntryInput | null {
    const thesisId = entry.thesisId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.thesisId) ? entry.thesisId : null;
    const parsed = journalEntrySchema.safeParse({
        id: entry.id,
        date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : isoDate(now),
        type: entry.type,
        ticker: entry.ticker.trim().slice(0, JOURNAL_ENTRY_LIMITS.ticker),
        decision: entry.decision.trim().slice(0, JOURNAL_ENTRY_LIMITS.decision),
        rationale: entry.rationale.trim().slice(0, JOURNAL_ENTRY_LIMITS.rationale),
        outcome: entry.outcome,
        thesisId,
        dismissed,
    });
    return parsed.success ? parsed.data : null;
}

function sameEntry(a: JournalEntry, b: JournalEntry): boolean {
    return a.date === b.date && a.type === b.type && a.ticker === b.ticker && a.decision === b.decision
        && a.rationale === b.rationale && a.outcome === b.outcome && (a.thesisId ?? null) === (b.thesisId ?? null);
}

/**
 * What to send from a journal this browser kept: the user's entries (edited
 * examples included) and a dismissal for each example they deleted. An
 * empty journal sends nothing: the browser showed the examples again then.
 */
export function journalImportItems(
    local: readonly JournalEntry[],
    examples: readonly JournalEntry[],
    now: number,
): { items: JournalEntryInput[]; shortened: boolean } {
    if (local.length === 0) return { items: [], shortened: false };
    const byId = new Map(examples.map((example) => [example.id, example]));
    const seen = new Set<string>();
    let shortened = false;
    const own = local.flatMap((entry) => {
        if (seen.has(entry.id)) return [];
        seen.add(entry.id);
        const example = byId.get(entry.id);
        if (example && sameEntry(entry, example)) return [];
        const input = toJournalEntryInput(entry, { now });
        // Text the browser allowed but the account doesn't (or an entry it can't store at all).
        if (!input || input.decision.length < entry.decision.trim().length || input.rationale.length < entry.rationale.trim().length
            || input.ticker.length < entry.ticker.trim().length) {
            shortened = true;
        }
        return input ? [input] : [];
    });
    const removed = examples.flatMap((example) => {
        if (seen.has(example.id)) return [];
        const input = toJournalEntryInput(example, { now, dismissed: true });
        return input ? [input] : [];
    });
    return { items: [...own, ...removed], shortened };
}

/** Where this browser keeps its full journal when the account couldn't take all of its text. */
export const JOURNAL_FULL_COPY_KEY = `${JOURNAL_STORAGE_KEY}-full-copy`;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function fetchAccountJournal(fetchImpl: Fetch = fetch): Promise<AccountJournal> {
    const response = await accountRequest(fetchImpl, '/api/research/journal');
    const body = (await response.json()) as { data?: Partial<AccountJournal> };
    return {
        entries: Array.isArray(body.data?.entries) ? body.data.entries : [],
        dismissed: Array.isArray(body.data?.dismissed) ? body.data.dismissed : [],
    };
}

export async function sendJournalWrite(id: string, write: JournalWrite, order: WriteOrder, fetchImpl: Fetch = fetch): Promise<void> {
    await sendRecordWrite(fetchImpl, `/api/research/journal/${encodeURIComponent(id)}`,
        { kind: 'put', body: { entry: write.entry } }, order);
}

/**
 * Sends the journal this browser kept for the user in `scope` to the
 * account, once per page load, then removes the browser's copy. A failed
 * send keeps the copy, and the next call tries again; the account keeps
 * entries it already has.
 */
export function importBrowserJournal(
    scope: string,
    {
        storage,
        examples,
        now,
        fetchImpl = fetch,
        onShortened,
    }: {
        storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
        examples: readonly JournalEntry[];
        now: number;
        fetchImpl?: Fetch;
        /** Called once when some text was longer than the account keeps. */
        onShortened?: () => void;
    },
): Promise<void> {
    return importOnce(`${JOURNAL_STORAGE_KEY}:${scope}`, async () => {
        const local = loadJournalFromStorage(storage, scope);
        if (!local) return;
        const { items, shortened } = journalImportItems(local, examples, now);
        await importInBatches(fetchImpl, '/api/research/journal/import', items, JOURNAL_IMPORT_MAX_ENTRIES);
        // Text the account couldn't take stays in this browser, under a key
        // of its own, rather than being lost.
        // The browser's journal goes only once its full text is kept: if the
        // copy can't be written (a full quota), the journal itself stays, and
        // the next load tries again.
        const kept = !shortened || writeUserValue(storage, JOURNAL_FULL_COPY_KEY, JSON.stringify({ version: 1, entries: local }), scope);
        if (kept) removeUserValue(storage, JOURNAL_STORAGE_KEY, scope);
        if (shortened) onShortened?.();
    });
}

