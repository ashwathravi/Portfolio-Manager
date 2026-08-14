
import 'dotenv/config';
import { db } from '../src/db';
import { authUsers, portfolios, holdings, transactions } from '../src/db/schema';
import { mockPortfolios, mockTransactions } from '../src/lib/mockData';
import { eq } from 'drizzle-orm';

async function seed() {
    console.log('🌱 Seeding database...');

    const userId = process.env.SEED_USER_ID?.trim()
        || process.env.AUTH_LOCAL_DEV_USER_ID?.trim();
    if (!userId) {
        throw new Error('Set SEED_USER_ID or AUTH_LOCAL_DEV_USER_ID to the exact Auth.js user id that owns the seed data.');
    }

    try {
        const [owner] = await db
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(eq(authUsers.id, userId))
            .limit(1);
        if (!owner) {
            throw new Error(`Seed owner ${userId} does not exist in auth_users. Sign in or provision the exact Auth.js user before seeding.`);
        }

        await db.transaction(async (tx) => {
            // Clear and rebuild only the explicit owner's data atomically. Child
            // holdings and transactions are removed by the portfolio FK cascade.
            await tx.delete(portfolios).where(eq(portfolios.userId, userId));

            for (const p of mockPortfolios) {
                console.log(`Inserting portfolio: ${p.name}`);

                const [insertedPortfolio] = await tx.insert(portfolios).values({
                    userId,
                    name: p.name,
                    description: p.description,
                    totalValue: p.totalValue,
                    cashBalance: p.cashBalance,
                }).returning({ id: portfolios.id });

                const newPortfolioId = insertedPortfolio.id;

                if (p.holdings && p.holdings.length > 0) {
                    const holdingsValues = p.holdings.map(h => ({
                        portfolioId: newPortfolioId,
                        symbol: h.ticker,
                        name: h.name,
                        quantity: String(h.quantity),
                        avgCost: String(h.avgCost),
                        currentPrice: h.currentPrice,
                        marketValue: h.marketValue,
                        allocation: h.allocation
                    }));
                    await tx.insert(holdings).values(holdingsValues);
                }

                if (p.id === 'main') {
                    const transactionValues = mockTransactions.map(t => ({
                        portfolioId: newPortfolioId,
                        timestamp: new Date(t.date),
                        type: t.type,
                        symbol: t.ticker,
                        quantity: t.quantity == null ? null : String(t.quantity),
                        price: t.price == null ? null : String(t.price),
                        amount: t.amount,
                        notes: t.notes
                    }));
                    await tx.insert(transactions).values(transactionValues);
                }
            }
        });

        console.log('✅ Seeding complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seed();
