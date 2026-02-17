
import 'dotenv/config';
import { db } from '../src/db';
import { portfolios, holdings, transactions } from '../src/db/schema';
import { mockPortfolios, mockTransactions } from '../src/lib/mockData';

async function seed() {
    console.log('🌱 Seeding database...');

    try {
        // 1. Clear existing data
        await db.delete(transactions);
        await db.delete(holdings);
        await db.delete(portfolios);

        // 2. Insert Portfolios, Holdings, Transactions
        for (const p of mockPortfolios) {
            console.log(`Inserting portfolio: ${p.name}`);

            const [insertedPortfolio] = await db.insert(portfolios).values({
                name: p.name,
                description: p.description,
                totalValue: p.totalValue,
                cashBalance: p.cashBalance,
            }).returning({ id: portfolios.id });

            const newPorfolioId = insertedPortfolio.id;

            // Insert Holdings
            if (p.holdings && p.holdings.length > 0) {
                const holdingsValues = p.holdings.map(h => ({
                    portfolioId: newPorfolioId,
                    ticker: h.ticker,
                    name: h.name,
                    quantity: h.quantity,
                    avgCost: h.avgCost,
                    currentPrice: h.currentPrice,
                    marketValue: h.marketValue,
                    allocation: h.allocation
                }));
                await db.insert(holdings).values(holdingsValues);
            }

            // Insert Transactions (Assigning 'main' transactions to the main portfolio)
            if (p.id === 'main') {
                const transactionValues = mockTransactions.map(t => ({
                    portfolioId: newPorfolioId,
                    date: new Date(t.date),
                    type: t.type,
                    ticker: t.ticker,
                    quantity: t.quantity,
                    price: t.price,
                    amount: t.amount,
                    notes: t.notes
                }));
                await db.insert(transactions).values(transactionValues);
            }
        }

        console.log('✅ Seeding complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seed();
