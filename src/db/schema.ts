
import { pgTable, text, numeric, doublePrecision, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------
export const portfolios = pgTable("portfolios", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    userId: uuid("user_id"),
    name: text("name").notNull(),
    description: text("description"),
    // Snapshot fields (denormalized for quick dashboard access)
    totalValue: doublePrecision("total_value").default(0),
    cashBalance: doublePrecision("cash_balance").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------
export const holdings = pgTable("holdings", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    quantity: numeric("quantity").notNull(),
    avgCost: numeric("avg_cost").notNull(),
    // Snapshot / cache columns — live values fetched at read-time
    currentPrice: doublePrecision("current_price"),
    marketValue: doublePrecision("market_value"),
    allocation: doublePrecision("allocation"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    portfolioIdIdx: index("holdings_portfolio_id_idx").on(table.portfolioId),
    symbolIdx: index("holdings_symbol_idx").on(table.symbol),
}));

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const transactions = pgTable("transactions", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    symbol: text("symbol"),
    type: text("type").notNull(), // 'BUY' | 'SELL' (extensible: 'dividend' | 'deposit' | 'withdrawal')
    quantity: numeric("quantity"),
    price: numeric("price"),
    timestamp: timestamp("timestamp").notNull(),
    // Legacy / convenience columns kept for backward compat
    amount: doublePrecision("amount"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    portfolioIdIdx: index("transactions_portfolio_id_idx").on(table.portfolioId),
    symbolIdx: index("transactions_symbol_idx").on(table.symbol),
}));

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
