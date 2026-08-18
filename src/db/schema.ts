
import {
    boolean,
    doublePrecision,
    index,
    integer,
    jsonb,
    numeric,
    pgPolicy,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

const serverOnlyNoClientAccessPolicy = () => pgPolicy("server_only_no_client_access", {
    as: "restrictive",
    for: "all",
    to: ["anon", "authenticated"],
    using: sql`false`,
    withCheck: sql`false`,
});

// ---------------------------------------------------------------------------
// Auth.js — Google OAuth identity and database sessions
// ---------------------------------------------------------------------------
export const authUsers = pgTable("auth_users", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
}, () => ({
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const authAccounts = pgTable("auth_accounts", {
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
}, (table) => ({
    userIdIdx: index("auth_accounts_user_id_idx").on(table.userId),
    compositePk: primaryKey({
        name: "auth_accounts_provider_provider_account_id_pk",
        columns: [table.provider, table.providerAccountId],
    }),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const authSessions = pgTable("auth_sessions", {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
}, (table) => ({
    userIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const authVerificationTokens = pgTable("auth_verification_tokens", {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
}, (table) => ({
    compositePk: primaryKey({
        name: "auth_verification_tokens_identifier_token_pk",
        columns: [table.identifier, table.token],
    }),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const authAuthenticators = pgTable("auth_authenticators", {
    credentialID: text("credential_id").notNull().unique(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
}, (table) => ({
    userCredentialPk: primaryKey({
        name: "auth_authenticators_user_id_credential_id_pk",
        columns: [table.userId, table.credentialID],
    }),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Plaid — durable, user-scoped token registry and account metadata
// ---------------------------------------------------------------------------
export const plaidItems = pgTable("plaid_items", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    plaidItemId: text("plaid_item_id").notNull(),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    status: text("status").default("active").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: text("access_token_iv").notNull(),
    accessTokenAuthTag: text("access_token_auth_tag").notNull(),
    keyVersion: text("key_version").default("v1").notNull(),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userStatusIdx: index("plaid_items_user_status_idx").on(table.userId, table.status),
    userItemIdx: uniqueIndex("plaid_items_user_item_idx").on(table.userId, table.plaidItemId),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const plaidAccounts = pgTable("plaid_accounts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    plaidItemRecordId: uuid("plaid_item_record_id")
        .notNull()
        .references(() => plaidItems.id, { onDelete: "cascade" }),
    plaidAccountId: text("plaid_account_id").notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    mask: text("mask"),
    type: text("type").notNull(),
    subtype: text("subtype").notNull(),
    currentBalance: numeric("current_balance"),
    isoCurrencyCode: text("iso_currency_code"),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    capabilities: jsonb("capabilities").notNull(),
    verificationStatus: text("verification_status").notNull(),
    syncStatus: text("sync_status").default("sync_ready").notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userIdx: index("plaid_accounts_user_idx").on(table.userId),
    itemIdx: index("plaid_accounts_item_idx").on(table.plaidItemRecordId),
    userAccountIdx: uniqueIndex("plaid_accounts_user_account_idx").on(table.userId, table.plaidAccountId),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------
export const portfolios = pgTable("portfolios", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    // Snapshot fields (denormalized for quick dashboard access)
    totalValue: doublePrecision("total_value").default(0),
    cashBalance: doublePrecision("cash_balance").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index("portfolios_user_id_idx").on(table.userId),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

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
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

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
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Alpha Radar — 13F research domain
// ---------------------------------------------------------------------------
export const alphaRadarTrackedFilers = pgTable("alpha_radar_tracked_filers", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    cik: text("cik").notNull(),
    secEntityName: text("sec_entity_name"),
    managerName: text("manager_name"),
    fundStyle: text("fund_style"),
    enabled: boolean("enabled").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugIdx: uniqueIndex("alpha_radar_tracked_filers_slug_idx").on(table.slug),
    cikIdx: uniqueIndex("alpha_radar_tracked_filers_cik_idx").on(table.cik),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const alphaRadarSecFilings = pgTable("alpha_radar_sec_filings", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    trackedFilerId: uuid("tracked_filer_id")
        .references(() => alphaRadarTrackedFilers.id, { onDelete: "cascade" })
        .notNull(),
    cik: text("cik").notNull(),
    accessionNumber: text("accession_number").notNull(),
    filingType: text("filing_type").notNull(),
    reportPeriod: text("report_period").notNull(),
    filedAt: timestamp("filed_at"),
    acceptedAt: timestamp("accepted_at"),
    primaryDocumentUrl: text("primary_document_url"),
    informationTableUrl: text("information_table_url"),
    status: text("status").default("discovered").notNull(),
    rawSubmission: jsonb("raw_submission"),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    trackedFilerIdx: index("alpha_radar_sec_filings_tracked_filer_idx").on(table.trackedFilerId),
    periodIdx: index("alpha_radar_sec_filings_period_idx").on(table.reportPeriod),
    accessionIdx: uniqueIndex("alpha_radar_sec_filings_accession_idx").on(table.accessionNumber),
    filerPeriodTypeIdx: uniqueIndex("alpha_radar_sec_filings_filer_period_type_idx").on(
        table.trackedFilerId,
        table.reportPeriod,
        table.filingType,
    ),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const alphaRadarFilingHoldings = pgTable("alpha_radar_filing_holdings", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    filingId: uuid("filing_id")
        .references(() => alphaRadarSecFilings.id, { onDelete: "cascade" })
        .notNull(),
    issuerName: text("issuer_name").notNull(),
    cusip: text("cusip").notNull(),
    ticker: text("ticker"),
    valueUsd: numeric("value_usd").notNull(),
    shares: numeric("shares").notNull(),
    putCall: text("put_call"),
    securityType: text("security_type"),
    investmentDiscretion: text("investment_discretion"),
    votingAuthoritySole: numeric("voting_authority_sole"),
    votingAuthorityShared: numeric("voting_authority_shared"),
    votingAuthorityNone: numeric("voting_authority_none"),
    positionRank: integer("position_rank"),
    rawHolding: jsonb("raw_holding"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    filingIdx: index("alpha_radar_filing_holdings_filing_idx").on(table.filingId),
    cusipIdx: index("alpha_radar_filing_holdings_cusip_idx").on(table.cusip),
    tickerIdx: index("alpha_radar_filing_holdings_ticker_idx").on(table.ticker),
    filingCusipIdx: uniqueIndex("alpha_radar_filing_holdings_filing_cusip_idx").on(table.filingId, table.cusip),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const alphaRadarHoldingChanges = pgTable("alpha_radar_holding_changes", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    trackedFilerId: uuid("tracked_filer_id")
        .references(() => alphaRadarTrackedFilers.id, { onDelete: "cascade" })
        .notNull(),
    currentFilingId: uuid("current_filing_id").references(() => alphaRadarSecFilings.id, { onDelete: "set null" }),
    priorFilingId: uuid("prior_filing_id").references(() => alphaRadarSecFilings.id, { onDelete: "set null" }),
    reportPeriod: text("report_period").notNull(),
    changeType: text("change_type").notNull(),
    issuerName: text("issuer_name").notNull(),
    cusip: text("cusip").notNull(),
    ticker: text("ticker"),
    currentValueUsd: numeric("current_value_usd"),
    priorValueUsd: numeric("prior_value_usd"),
    valueDeltaUsd: numeric("value_delta_usd"),
    currentShares: numeric("current_shares"),
    priorShares: numeric("prior_shares"),
    shareDelta: numeric("share_delta"),
    currentWeight: doublePrecision("current_weight"),
    priorWeight: doublePrecision("prior_weight"),
    rankDelta: integer("rank_delta"),
    materialityScore: doublePrecision("materiality_score").default(0).notNull(),
    userRelevance: jsonb("user_relevance"),
    displayReason: text("display_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    trackedFilerIdx: index("alpha_radar_holding_changes_tracked_filer_idx").on(table.trackedFilerId),
    periodIdx: index("alpha_radar_holding_changes_period_idx").on(table.reportPeriod),
    cusipIdx: index("alpha_radar_holding_changes_cusip_idx").on(table.cusip),
    tickerIdx: index("alpha_radar_holding_changes_ticker_idx").on(table.ticker),
    filerPeriodCusipIdx: uniqueIndex("alpha_radar_holding_changes_filer_period_cusip_idx").on(
        table.trackedFilerId,
        table.reportPeriod,
        table.cusip,
    ),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const alphaRadarReports = pgTable("alpha_radar_reports", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    trackedFilerId: uuid("tracked_filer_id")
        .references(() => alphaRadarTrackedFilers.id, { onDelete: "cascade" })
        .notNull(),
    filingId: uuid("filing_id").references(() => alphaRadarSecFilings.id, { onDelete: "set null" }),
    reportPeriod: text("report_period").notNull(),
    status: text("status").default("generated").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    sections: jsonb("sections").notNull(),
    markdown: text("markdown").notNull(),
    sourceFilingIds: jsonb("source_filing_ids").notNull(),
    generatorVersion: text("generator_version").default("deterministic-v1").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    trackedFilerIdx: index("alpha_radar_reports_tracked_filer_idx").on(table.trackedFilerId),
    periodIdx: index("alpha_radar_reports_period_idx").on(table.reportPeriod),
    filerPeriodVersionIdx: uniqueIndex("alpha_radar_reports_filer_period_version_idx").on(
        table.trackedFilerId,
        table.reportPeriod,
        table.generatorVersion,
    ),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const alphaRadarSemanticChunks = pgTable("alpha_radar_semantic_chunks", {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    trackedFilerId: uuid("tracked_filer_id")
        .references(() => alphaRadarTrackedFilers.id, { onDelete: "cascade" }),
    filingId: uuid("filing_id").references(() => alphaRadarSecFilings.id, { onDelete: "set null" }),
    reportId: uuid("report_id").references(() => alphaRadarReports.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    citation: jsonb("citation").notNull(),
    metadata: jsonb("metadata"),
    keywords: jsonb("keywords").notNull(),
    embedding: jsonb("embedding"),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    sourceIdx: index("alpha_radar_semantic_chunks_source_idx").on(table.sourceKind, table.sourceId),
    trackedFilerPeriodIdx: index("alpha_radar_semantic_chunks_tracked_filer_period_idx").on(
        table.trackedFilerId,
        table.reportPeriod,
    ),
    reportIdx: index("alpha_radar_semantic_chunks_report_idx").on(table.reportId),
    filingIdx: index("alpha_radar_semantic_chunks_filing_idx").on(table.filingId),
    sourceChunkIdx: uniqueIndex("alpha_radar_semantic_chunks_source_chunk_idx").on(
        table.sourceKind,
        table.sourceId,
        table.chunkIndex,
    ),
    keywordsGinIdx: index("alpha_radar_semantic_chunks_keywords_gin_idx").using("gin", table.keywords),
    metadataGinIdx: index("alpha_radar_semantic_chunks_metadata_gin_idx").using("gin", table.metadata),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
})).enableRLS();

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
    user: one(authUsers, {
        fields: [portfolios.userId],
        references: [authUsers.id],
    }),
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

export const alphaRadarTrackedFilersRelations = relations(alphaRadarTrackedFilers, ({ many }) => ({
    filings: many(alphaRadarSecFilings),
    holdingChanges: many(alphaRadarHoldingChanges),
    reports: many(alphaRadarReports),
    semanticChunks: many(alphaRadarSemanticChunks),
}));

export const alphaRadarSecFilingsRelations = relations(alphaRadarSecFilings, ({ one, many }) => ({
    trackedFiler: one(alphaRadarTrackedFilers, {
        fields: [alphaRadarSecFilings.trackedFilerId],
        references: [alphaRadarTrackedFilers.id],
    }),
    holdings: many(alphaRadarFilingHoldings),
    reports: many(alphaRadarReports),
    semanticChunks: many(alphaRadarSemanticChunks),
}));

export const alphaRadarFilingHoldingsRelations = relations(alphaRadarFilingHoldings, ({ one }) => ({
    filing: one(alphaRadarSecFilings, {
        fields: [alphaRadarFilingHoldings.filingId],
        references: [alphaRadarSecFilings.id],
    }),
}));

export const alphaRadarHoldingChangesRelations = relations(alphaRadarHoldingChanges, ({ one }) => ({
    trackedFiler: one(alphaRadarTrackedFilers, {
        fields: [alphaRadarHoldingChanges.trackedFilerId],
        references: [alphaRadarTrackedFilers.id],
    }),
    currentFiling: one(alphaRadarSecFilings, {
        fields: [alphaRadarHoldingChanges.currentFilingId],
        references: [alphaRadarSecFilings.id],
        relationName: "currentFiling",
    }),
    priorFiling: one(alphaRadarSecFilings, {
        fields: [alphaRadarHoldingChanges.priorFilingId],
        references: [alphaRadarSecFilings.id],
        relationName: "priorFiling",
    }),
}));

export const alphaRadarReportsRelations = relations(alphaRadarReports, ({ one, many }) => ({
    trackedFiler: one(alphaRadarTrackedFilers, {
        fields: [alphaRadarReports.trackedFilerId],
        references: [alphaRadarTrackedFilers.id],
    }),
    filing: one(alphaRadarSecFilings, {
        fields: [alphaRadarReports.filingId],
        references: [alphaRadarSecFilings.id],
    }),
    semanticChunks: many(alphaRadarSemanticChunks),
}));

export const alphaRadarSemanticChunksRelations = relations(alphaRadarSemanticChunks, ({ one }) => ({
    trackedFiler: one(alphaRadarTrackedFilers, {
        fields: [alphaRadarSemanticChunks.trackedFilerId],
        references: [alphaRadarTrackedFilers.id],
    }),
    filing: one(alphaRadarSecFilings, {
        fields: [alphaRadarSemanticChunks.filingId],
        references: [alphaRadarSecFilings.id],
    }),
    report: one(alphaRadarReports, {
        fields: [alphaRadarSemanticChunks.reportId],
        references: [alphaRadarReports.id],
    }),
}));

export const plaidItemsRelations = relations(plaidItems, ({ one, many }) => ({
    user: one(authUsers, {
        fields: [plaidItems.userId],
        references: [authUsers.id],
    }),
    accounts: many(plaidAccounts),
}));

export const plaidAccountsRelations = relations(plaidAccounts, ({ one }) => ({
    user: one(authUsers, {
        fields: [plaidAccounts.userId],
        references: [authUsers.id],
    }),
    item: one(plaidItems, {
        fields: [plaidAccounts.plaidItemRecordId],
        references: [plaidItems.id],
    }),
}));
