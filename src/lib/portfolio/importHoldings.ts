import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { holdings, portfolios } from '@/db/schema';
import type { PortfolioImportBody } from '@/lib/validators/portfolio-import';
import { planHoldingsImport, summarizePlan } from './csvImport';
import { buildLockUserAccountsQuery, checkAccountName } from './manage';
import { importOptionRows, type OptionImportResult } from './option-positions-store';

export class ImportAccessError extends Error {
    constructor() {
        super('Portfolio not found');
        this.name = 'ImportAccessError';
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
}

/**
 * Writes a validated CSV import for `userId` in one transaction. The target
 * account must belong to the user (checked inside the transaction, so a
 * foreign id is a 404 with nothing written); a new account is created for
 * them otherwise, under the same name and limit checks as creating one
 * (`checkAccountName` in manage.ts). Rows for symbols already held replace
 * those positions; other positions are untouched. Option rows go to the
 * account's option positions the same way (importOptionRows).
 *
 * Every import takes the user's account-write lock first, as a Plaid sync
 * does: an import into a linked account locks the portfolio row (FOR
 * UPDATE) and then its holdings and option rows, the opposite order to
 * writeAccountSync, so without it the two could deadlock; and
 * importOptionRows reads which contracts the sync owns.
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
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        return importInto(tx, userId, body, quoteFrom(prices));
    });
}

type Transaction = Parameters<Parameters<typeof db['transaction']>[0]>[0];
type ImportBody = Omit<PortfolioImportBody, 'options'> & Partial<Pick<PortfolioImportBody, 'options'>>;

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
    const quote = quoteFrom(prices);
    return database.transaction(async (tx) => {
        // The user's account-write lock first, as a Plaid sync takes it,
        // before any account's rows: taken midway (by a new account's name
        // check) or not at all, the import would hold rows a sync waits on
        // while it waits on the sync (see importHoldings).
        await buildLockUserAccountsQuery(userId, tx);
        const results: ImportResult[] = [];
        for (const group of groups) results.push(await importInto(tx, userId, group, quote));
        return results;
    });
}

async function importInto(tx: Transaction, userId: string, body: ImportBody, quote: (symbol: string) => number | null): Promise<ImportResult> {
    let portfolioId: string;
    let createdPortfolio = false;

    if (body.portfolioId) {
        // FOR UPDATE serializes concurrent imports into the same account:
        // the second waits, then sees the first one's rows and updates them
        // rather than tripping the unique (portfolio, symbol) key.
        const [owned] = await tx
            .select({ id: portfolios.id })
            .from(portfolios)
            .where(and(eq(portfolios.id, body.portfolioId), eq(portfolios.userId, userId)))
            .limit(1)
            .for('update');
        if (!owned) throw new ImportAccessError();
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
    if (summary.insert + summary.update + options.insert + options.update > 0) {
        await tx.update(portfolios).set({ updatedAt: now }).where(eq(portfolios.id, portfolioId));
    }

    return { portfolioId, createdPortfolio, ...summary, options };
}
