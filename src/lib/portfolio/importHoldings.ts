import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { holdings, portfolios } from '@/db/schema';
import { withinRecordLimit } from '@/lib/limits/records-server';
import type { PortfolioImportBody } from '@/lib/validators/portfolio-import';
import { describeLinkedAccountRefusal, planHoldingsImport, summarizePlan } from './csvImport';
import { buildLockUserAccountsQuery, buildSyncingAccountsQuery, checkAccountName } from './manage';
import { importManualRows, type ManualImportResult } from './manual-holdings';
import { importOptionRows, type OptionImportResult } from './option-positions-store';

export class ImportAccessError extends Error {
    constructor() {
        super('Portfolio not found');
        this.name = 'ImportAccessError';
    }
}

/**
 * Holdings valued by hand aimed at a linked account that still syncs. Its
 * institution reports the account's holdings without a ticker, and a sync
 * replaces only its own, so a file's copies would be counted twice and
 * never removed.
 */
export class LinkedAccountImportError extends Error {
    constructor(readonly accountName: string) {
        super(describeLinkedAccountRefusal(accountName));
        this.name = 'LinkedAccountImportError';
    }
}

export interface ImportResult {
    portfolioId: string;
    createdPortfolio: boolean;
    insert: number;
    update: number;
    unchanged: number;
    /** The file's option positions (launch item i63). */
    options: OptionImportResult;
    /** The file's rows with no ticker, valued by hand; zeros when it has none. */
    manual: ManualImportResult;
}

/**
 * Writes a validated CSV import for `userId` in one transaction. The target
 * account must belong to the user (checked inside the transaction, so a
 * foreign id is a 404 with nothing written); a new account is created for
 * them otherwise, under the same name and limit checks as creating one
 * (`checkAccountName` in manage.ts). Rows for symbols already held replace
 * those positions; other positions are untouched. Option rows go to the
 * account's option positions the same way (importOptionRows), and rows with
 * no ticker to its holdings valued by hand (importManualRows), which a
 * linked account refuses while it syncs (LinkedAccountImportError). Once
 * it no longer syncs (disconnected, say), those holdings are the user's,
 * and a file updates the ones its last sync brought in.
 *
 * Every import takes the user's account-write lock first, as a Plaid sync
 * does: an import into a linked account locks the portfolio row (FOR
 * UPDATE) and then its holdings and option rows, the opposite order to
 * writeAccountSync, so without it the two could deadlock; and
 * importOptionRows reads which contracts the sync owns. A file with
 * holdings valued by hand then takes the records lock their limit is
 * counted under (withinRecordLimit), still before any account's row, as
 * the card's add does.
 *
 * `prices` (upper-case symbol → last price, from the price store) gives
 * the rows it covers a stored price, so an imported position shows its
 * worth straight away instead of $0. No market value is stored with it:
 * readers value positions at quantity × the newest price they have, and a
 * stored value would hold them at today's. A new row without a price gets
 * none, and readers value it at cost; a replaced row without one keeps the
 * price it had.
 */
export async function importHoldings(
    userId: string,
    body: ImportBody,
    prices: Readonly<Record<string, number>> = {},
    database: typeof db = db,
): Promise<ImportResult> {
    const [result] = await importGroups(userId, [body], prices, database);
    return result;
}

type Transaction = Parameters<Parameters<typeof db['transaction']>[0]>[0];
type Optional = 'options' | 'manual' | 'valuesAsOf';
type ImportBody = Omit<PortfolioImportBody, Optional> & Partial<Pick<PortfolioImportBody, Optional>>;

function quoteFrom(prices: Readonly<Record<string, number>>) {
    return (symbol: string): number | null => {
        const price = prices[symbol.toUpperCase()];
        return Number.isFinite(price) && price > 0 ? price : null;
    };
}

/**
 * A positions export covering several accounts (a Fidelity or Monarch
 * export): each group as `importHoldings` imports one, all in one
 * transaction, so a refused group (another user's account, a duplicate new
 * name, the account limit) writes nothing for any of them.
 */
export async function importHoldingsToAccounts(
    userId: string,
    groups: readonly ImportBody[],
    prices: Readonly<Record<string, number>> = {},
    database: typeof db = db,
): Promise<ImportResult[]> {
    return importGroups(userId, groups, prices, database);
}

function importGroups(
    userId: string,
    groups: readonly ImportBody[],
    prices: Readonly<Record<string, number>>,
    database: typeof db,
): Promise<ImportResult[]> {
    const quote = quoteFrom(prices);
    return database.transaction(async (tx) => {
        // The user's account-write lock first, as a Plaid sync takes it,
        // before any account's rows: taken midway (by a new account's name
        // check) or not at all, the import would hold rows a sync waits on
        // while it waits on the sync (see importHoldings).
        await buildLockUserAccountsQuery(userId, tx);
        const write = async () => {
            const results: ImportResult[] = [];
            for (const group of groups) results.push(await importInto(tx, userId, group, quote));
            return results;
        };
        // Holdings valued by hand have a limit per user, counted under its
        // own lock: taken next, so the order stays account lock, records
        // lock, then the account's row.
        return groups.some((g) => (g.manual?.length ?? 0) > 0) ? withinRecordLimit(tx, 'manualHoldings', userId, write) : write();
    });
}

const NO_MANUAL_ROWS: ManualImportResult = { insert: 0, update: 0, unchanged: 0, replacedPositions: 0 };

async function importInto(tx: Transaction, userId: string, body: ImportBody, quote: (symbol: string) => number | null): Promise<ImportResult> {
    let portfolioId: string;
    let createdPortfolio = false;
    const manualRows = body.manual ?? [];

    if (body.portfolioId) {
        // FOR UPDATE serializes concurrent imports into the same account:
        // the second waits, then sees the first one's rows and updates them
        // rather than tripping the unique (portfolio, symbol) key.
        const [owned] = await tx
            .select({ id: portfolios.id, name: portfolios.name, source: portfolios.source })
            .from(portfolios)
            .where(and(eq(portfolios.id, body.portfolioId), eq(portfolios.userId, userId)))
            .limit(1)
            .for('update');
        if (!owned) throw new ImportAccessError();
        // Whether a linked account still syncs, as its option positions are
        // decided: one disconnected or revoked stays 'plaid' but syncs no more.
        if (manualRows.length > 0 && owned.source === 'plaid' && (await buildSyncingAccountsQuery(userId, tx, owned.id)).length > 0) {
            throw new LinkedAccountImportError(owned.name);
        }
        portfolioId = owned.id;
    } else {
        await checkAccountName(tx, userId, body.newPortfolioName!, null);
        const [created] = await tx
            .insert(portfolios)
            .values({ userId, name: body.newPortfolioName!, description: 'Imported from CSV' })
            .returning({ id: portfolios.id });
        portfolioId = created.id;
        createdPortfolio = true;
    }

    const existing = await tx
        .select({ id: holdings.id, symbol: holdings.symbol, quantity: holdings.quantity, avgCost: holdings.avgCost })
        .from(holdings)
        .where(eq(holdings.portfolioId, portfolioId));

    const plan = planHoldingsImport(
        existing.map((h) => ({ id: h.id, symbol: h.symbol, quantity: Number(h.quantity), avgCost: Number(h.avgCost) })),
        body.rows,
    );

    const now = new Date();
    const inserts = plan.flatMap((p) => (p.kind === 'insert' ? [p.row] : []));
    if (inserts.length > 0) {
        await tx.insert(holdings).values(
            inserts.map((r) => ({
                portfolioId,
                symbol: r.symbol,
                name: r.name || r.symbol,
                quantity: String(r.quantity),
                avgCost: String(r.avgCost),
                currentPrice: quote(r.symbol),
                marketValue: null,
            })),
        );
    }
    for (const p of plan) {
        if (p.kind !== 'update') continue;
        const price = quote(p.row.symbol);
        await tx
            .update(holdings)
            .set({
                quantity: String(p.row.quantity),
                avgCost: String(p.row.avgCost),
                // Snapshot fields were computed for the old quantity: keep
                // the stored price unless there's a newer one, and leave
                // the value to readers.
                ...(price != null ? { currentPrice: price } : {}),
                marketValue: null,
                allocation: null,
                ...(p.row.name ? { name: p.row.name } : {}),
                updatedAt: now,
            })
            .where(and(eq(holdings.id, p.id), eq(holdings.portfolioId, portfolioId)));
    }

    const summary = summarizePlan(plan);
    const options = await importOptionRows(tx, userId, portfolioId, body.options ?? [], now);
    let manual = NO_MANUAL_ROWS;
    let manualChanged = false;
    if (manualRows.length > 0) {
        // Never a position this file itself writes.
        const written = new Set(body.rows.map((r) => r.symbol));
        const { replace, changed, ...counts } = await importManualRows(tx, userId, portfolioId, manualRows, {
            asOf: body.valuesAsOf ?? now.toISOString().slice(0, 10),
            positions: existing.map((h) => h.symbol).filter((symbol) => !written.has(symbol)),
            now,
        });
        if (replace.length > 0) {
            await tx.delete(holdings).where(and(eq(holdings.portfolioId, portfolioId), inArray(holdings.symbol, replace)));
        }
        manual = counts;
        manualChanged = changed;
    }
    // A new value of a holding valued by hand is a price, as a sync's is:
    // the account changes when what it holds does.
    if (summary.insert + summary.update + options.insert + options.update + manual.insert + manual.replacedPositions > 0 || manualChanged) {
        await tx.update(portfolios).set({ updatedAt: now }).where(eq(portfolios.id, portfolioId));
    }

    return { portfolioId, createdPortfolio, ...summary, options, manual };
}
