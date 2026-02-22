
import { pgTable, text, doublePrecision, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// Portfolios Table
export const portfolios = pgTable("portfolios", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // Snapshot fields (denormalized for quick access, similar to mock)
    totalValue: doublePrecision("total_value").default(0),
    cashBalance: doublePrecision("cash_balance").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Holdings Table
export const holdings = pgTable("holdings", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    avgCost: doublePrecision("avg_cost").notNull(),
    // Current price and market value would typically be fetched live or cached
    // We store them here to match the 'snapshot' nature of the mock data for now
    currentPrice: doublePrecision("current_price"),
    marketValue: doublePrecision("market_value"),
    allocation: doublePrecision("allocation"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
    return {
        portfolioIdIdx: index("holdings_portfolio_id_idx").on(table.portfolioId),
    };
});

// Transactions Table
export const transactions = pgTable("transactions", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    date: timestamp("date").notNull(),
    type: text("type").notNull(), // 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal'
    ticker: text("ticker"),
    quantity: doublePrecision("quantity"),
    price: doublePrecision("price"),
    amount: doublePrecision("amount").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const portfoliosRelations = relations(portfolios, ({ many }) => ({
    holdings: many(holdings),
    transactions: many(transactions),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
    portfolio: one(portfolios, {
        fields: [holdings.portfolioId],
        references: [portfolios.id],
    }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
    portfolio: one(portfolios, {
        fields: [transactions.portfolioId],
        references: [portfolios.id],
    }),
}));
