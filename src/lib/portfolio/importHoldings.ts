import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { holdings, portfolios } from '@/db/schema';
import type { PortfolioImportBody } from '@/lib/validators/portfolio-import';
import { planHoldingsImport, summarizePlan } from './csvImport';

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
}

/**
 * Writes a validated CSV import for `userId` in one transaction. The target
 * account must belong to the user (checked inside the transaction, so a
 * foreign id is a 404 with nothing written); a new account is created for
 * them otherwise. Rows for symbols already held replace those positions;
 * other positions are untouched.
 *
 * `prices` (upper-case symbol → last price, from the price store) gives
 * the rows it covers a stored price, so an imported position shows its
 * worth straight away instead of $0. No market value is stored with it:
 * readers value positions at quantity × the newest price they have, and a
 * stored value would hold them at today's. Rows without a price keep none,
 * and readers value them at cost.
 */
export async function importHoldings(
    userId: string,
    body: PortfolioImportBody,
    prices: Readonly<Record<string, number>> = {},
    database: typeof db = db,
): Promise<ImportResult> {
    const priced = (symbol: string) => {
        const price = prices[symbol.toUpperCase()];
        return { currentPrice: Number.isFinite(price) && price > 0 ? price : null, marketValue: null };
    };
    return database.transaction(async (tx) => {
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
                    ...priced(r.symbol),
                })),
            );
        }
        for (const p of plan) {
            if (p.kind !== 'update') continue;
            await tx
                .update(holdings)
                .set({
                    quantity: String(p.row.quantity),
                    avgCost: String(p.row.avgCost),
                    // Snapshot fields were computed for the old quantity: keep
                    // the stored price, and leave the value to readers.
                    ...priced(p.row.symbol),
                    allocation: null,
                    ...(p.row.name ? { name: p.row.name } : {}),
                    updatedAt: now,
                })
                .where(and(eq(holdings.id, p.id), eq(holdings.portfolioId, portfolioId)));
        }

        const summary = summarizePlan(plan);
        if (summary.insert + summary.update > 0) {
            await tx.update(portfolios).set({ updatedAt: now }).where(eq(portfolios.id, portfolioId));
        }

        return { portfolioId, createdPortfolio, ...summary };
    });
}
