
import {
    bigint,
    boolean,
    check,
    date,
    doublePrecision,
    foreignKey,
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

// The app connects as a login role that is a member of app_runtime (created
// in migration 0010) instead of the table owner, so RLS applies to it. This
// policy is what lets it read and write; tenant scoping stays in app code.
const appRuntimeAccessPolicy = () => pgPolicy("app_runtime_access", {
    as: "permissive",
    for: "all",
    to: "app_runtime",
    using: sql`true`,
    withCheck: sql`true`,
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    // "awaiting_selection" from Link until the user picks the accounts to
    // connect, then "sync_ready" (synced into a portfolio) or "excluded"
    // (left out, or its portfolio deleted). Only "sync_ready" is synced.
    syncStatus: text("sync_status").default("awaiting_selection").notNull(),
    // The last sync of its holdings and transactions; null before the first.
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userIdx: index("plaid_accounts_user_idx").on(table.userId),
    itemIdx: index("plaid_accounts_item_idx").on(table.plaidItemRecordId),
    userAccountIdx: uniqueIndex("plaid_accounts_user_account_idx").on(table.userId, table.plaidAccountId),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    // Where the account comes from (decision D5): "manual" (added here or
    // imported from a CSV) or "plaid", one portfolio per linked investment
    // account, whose Plaid account_id is the external id. A sync replaces a
    // linked account's holdings and cash, and upserts its transactions.
    source: text("source").default("manual").notNull(),
    externalAccountId: text("external_account_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index("portfolios_user_id_idx").on(table.userId),
    userExternalAccountIdx: uniqueIndex("portfolios_user_source_external_account_idx")
        .on(table.userId, table.source, table.externalAccountId)
        .where(sql`${table.externalAccountId} is not null`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    // One row per symbol in an account (launch item i41); symbols are stored
    // upper-case.
    portfolioSymbolIdx: uniqueIndex("holdings_portfolio_symbol_idx").on(table.portfolioId, table.symbol),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    // Launch item i40: what the trade cost beyond its value, the currency
    // its amounts are in, where it came from (manual, csv), and the source's
    // own ID for it, which keeps an import from adding it twice.
    fees: numeric("fees"),
    currency: text("currency").notNull().default("USD"),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    portfolioIdIdx: index("transactions_portfolio_id_idx").on(table.portfolioId),
    symbolIdx: index("transactions_symbol_idx").on(table.symbol),
    externalIdIdx: uniqueIndex("transactions_portfolio_external_id_idx")
        .on(table.portfolioId, table.externalId)
        .where(sql`${table.externalId} is not null`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
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
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Market data — the tracked securities and their daily price history
// ---------------------------------------------------------------------------
// Only symbols someone holds, watches or benchmarks against are tracked:
// bars for every US ticker would fill the free database tier within two
// years. The nightly ingest filters the market-wide daily file to this set.
export const securities = pgTable("securities", {
    symbol: text("symbol").primaryKey(),
    name: text("name"),
    // Provider security type, e.g. "CS" (common stock) or "ETF".
    type: text("type"),
    primaryExchange: text("primary_exchange"),
    currency: text("currency").default("USD").notNull(),
    active: boolean("active").default(true).notNull(),
    // From the ticker reference data (launch item i34): the app's sector,
    // mapped from the SIC industry code (kept, so the mapping can change
    // without fetching again), and the code's description as the industry.
    sector: text("sector"),
    industry: text("industry"),
    sicCode: text("sic_code"),
    // When the reference data was last fetched (or found missing); null
    // until the nightly job has fetched it.
    referenceUpdatedAt: timestamp("reference_updated_at"),
    // The last fetch that failed (a provider error), so the queue takes
    // never-tried symbols first and failures rotate behind them.
    referenceAttemptedAt: timestamp("reference_attempted_at"),
    // Null until the history backfill has run; then the earliest date it covers.
    historyStartDate: date("history_start_date", { mode: "string" }),
    // The last backfill attempt that left the symbol queued (an error, or no
    // complete history yet). The queue takes never-tried symbols first, then
    // the least recently tried, so persistent failures can't block the rest.
    historyAttemptedAt: timestamp("history_attempted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, () => ({
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// Split-adjusted daily bars keyed by Eastern trading date. A split rewrites
// history, so the ingest refetches a symbol's bars when one is announced.
export const priceBars = pgTable("price_bars", {
    symbol: text("symbol")
        .notNull()
        .references(() => securities.symbol, { onDelete: "cascade", onUpdate: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull(),
    // Which provider supplied the bar, e.g. "massive".
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.symbol, table.date] }),
    dateIdx: index("price_bars_date_idx").on(table.date),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Scheduled jobs — one row per run of a cron job (launch item i48)
// ---------------------------------------------------------------------------
export type JobRunStatus = "running" | "succeeded" | "failed";

// A row starts as "running" and is finished with the job's detail or a short
// error. One that stays "running" with no finished_at was cut off mid-run
// (the function timed out or the instance died).
export const jobRuns = pgTable("job_runs", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    status: text("status").$type<JobRunStatus>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    error: text("error"),
}, (table) => ({
    jobStartedAtIdx: index("job_runs_job_started_at_idx").on(table.job, table.startedAt),
    statusCheck: check("job_runs_status_check", sql`${table.status} in ('running', 'succeeded', 'failed')`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Settings (launch item i37, decision D6)
// ---------------------------------------------------------------------------

/**
 * Each user's settings as one versioned JSON document: the persisted slices
 * of the settings store (`persistedSettings` in src/lib/stores/settingsStore.ts).
 * `version` is the store's schema version the document was written at;
 * readers migrate older documents forward (`migrateSettings`).
 */
export const userSettings = pgTable("user_settings", {
    userId: text("user_id")
        .primaryKey()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, () => ({
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Valuation snapshots (launch item i42)
// ---------------------------------------------------------------------------

/**
 * A portfolio's value at one session's close: holdings × close + cash.
 * Written by the nightly "snapshots" job, only for a day after which nothing
 * in the portfolio changed (src/lib/portfolio/valuation-snapshots.ts), so it
 * records what the portfolio really held then. Returns (i49) and attribution
 * (i50) read this history; it can't be rebuilt once holdings change.
 */
export const portfolioSnapshots = pgTable("portfolio_snapshots", {
    portfolioId: uuid("portfolio_id")
        .notNull()
        .references(() => portfolios.id, { onDelete: "cascade" }),
    // Eastern trading date of the close it is valued at.
    date: date("date", { mode: "string" }).notNull(),
    holdingsValue: doublePrecision("holdings_value").notNull(),
    cash: doublePrecision("cash").notNull(),
    totalValue: doublePrecision("total_value").notNull(),
    costBasis: doublePrecision("cost_basis").notNull(),
    positions: integer("positions").notNull(),
    // Held symbols with no recent close: left out of holdings_value, so the
    // snapshot is partial. The job recomputes partial snapshots while it can.
    unpriced: text("unpriced").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.portfolioId, table.date] }),
    dateIdx: index("portfolio_snapshots_date_idx").on(table.date),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

/** Each position in a snapshot, one row per symbol (holdings of one symbol are combined). */
export const portfolioSnapshotPositions = pgTable("portfolio_snapshot_positions", {
    portfolioId: uuid("portfolio_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    symbol: text("symbol").notNull(),
    quantity: numeric("quantity").notNull(),
    costBasis: doublePrecision("cost_basis").notNull(),
    // Null when unpriced; otherwise the close it was valued at and its date
    // (the session's, or the last one before it if the stock didn't trade).
    close: doublePrecision("close"),
    closeDate: date("close_date", { mode: "string" }),
    marketValue: doublePrecision("market_value"),
}, (table) => ({
    pk: primaryKey({ columns: [table.portfolioId, table.date, table.symbol] }),
    snapshot: foreignKey({
        name: "portfolio_snapshot_positions_snapshot_fk",
        columns: [table.portfolioId, table.date],
        foreignColumns: [portfolioSnapshots.portfolioId, portfolioSnapshots.date],
    }).onDelete("cascade"),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

// ---------------------------------------------------------------------------
// Research workspace (launch item i38, decision D6)
// ---------------------------------------------------------------------------

/**
 * The user's watchlist (src/lib/research/watchlist.ts). `id` is the one the
 * browser made, so the example rows keep theirs when the user adopts or
 * edits one; an example the user removed stays as a `dismissed` row so it
 * isn't shown again. One live row per ticker.
 */
export const watchlistItems = pgTable("watchlist_items", {
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    ticker: text("ticker").notNull(),
    companyName: text("company_name").notNull().default(""),
    reason: text("reason").notNull().default(""),
    notes: text("notes").notNull().default(""),
    targetEntry: doublePrecision("target_entry"),
    addedAt: date("added_at", { mode: "string" }).notNull(),
    dismissed: boolean("dismissed").notNull().default(false),
    // The page that last wrote the row and its count of writes then: a
    // write from the same page applies only if it is newer, so a request
    // that arrives late can't undo a later edit.
    writeSession: text("write_session"),
    writeSeq: bigint("write_seq", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.id], name: "watchlist_items_pkey" }),
    userTickerIdx: uniqueIndex("watchlist_items_user_ticker_idx")
        .on(table.userId, table.ticker)
        .where(sql`not ${table.dismissed}`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

/**
 * The user's decision journal (src/lib/research/journal.ts). As with the
 * watchlist, `id` is the browser's, and an example entry the user deletes
 * stays as a `dismissed` row so it isn't shown again. `thesis_id` points at
 * a thesis by its ID; it isn't a foreign key, since example theses aren't
 * stored.
 */
export const journalEntries = pgTable("journal_entries", {
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    type: text("type").notNull(),
    ticker: text("ticker").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    outcome: text("outcome").notNull(),
    thesisId: text("thesis_id"),
    dismissed: boolean("dismissed").notNull().default(false),
    // As for watchlist_items: the page that last wrote the row, and its count.
    writeSession: text("write_session"),
    writeSeq: bigint("write_seq", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.id], name: "journal_entries_pkey" }),
    typeCheck: check("journal_entries_type_check", sql`${table.type} in ('entry', 'exit', 'hold')`),
    outcomeCheck: check("journal_entries_outcome_check", sql`${table.outcome} in ('win', 'loss', 'pending')`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

/**
 * The user's investment theses (src/lib/research/thesis.ts), with their
 * catalysts and evidence in tables of their own. As for the watchlist and
 * journal, `id` is the browser's, a deleted thesis stays as a `dismissed`
 * row with its text cleared, and writes are ordered per page.
 */
export const theses = pgTable("theses", {
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    ticker: text("ticker").notNull(),
    companyName: text("company_name").notNull().default(""),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // bull or bear
    type: text("type").notNull(),
    status: text("status").notNull(),
    conviction: text("conviction").notNull(),
    targetPrice: doublePrecision("target_price").notNull(),
    currentPrice: doublePrecision("current_price"),
    timeHorizon: text("time_horizon").notNull().default(""),
    dateCreated: date("date_created", { mode: "string" }).notNull(),
    dateUpdated: date("date_updated", { mode: "string" }).notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    hypothesis: text("hypothesis").notNull().default(""),
    bullCase: jsonb("bull_case").$type<string[]>().notNull().default([]),
    bearCase: jsonb("bear_case").$type<string[]>().notNull().default([]),
    healthScore: integer("health_score").notNull().default(50),
    dismissed: boolean("dismissed").notNull().default(false),
    writeSession: text("write_session"),
    writeSeq: bigint("write_seq", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.id], name: "theses_pkey" }),
    typeCheck: check("theses_type_check", sql`${table.type} in ('bull', 'bear')`),
    statusCheck: check("theses_status_check", sql`${table.status} in ('active', 'monitoring', 'archived')`),
    convictionCheck: check("theses_conviction_check", sql`${table.conviction} in ('HIGH', 'MEDIUM', 'LOW')`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

/**
 * A thesis's catalysts, in the order the user added them. `date` is free
 * text ("2026-05-01", "Q2 2026"), as the form takes it.
 */
export const thesisCatalysts = pgTable("thesis_catalysts", {
    userId: text("user_id").notNull(),
    thesisId: text("thesis_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    date: text("date").notNull().default(""),
    impact: text("impact").notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.thesisId, table.id], name: "thesis_catalysts_pkey" }),
    thesis: foreignKey({
        name: "thesis_catalysts_thesis_fk",
        columns: [table.userId, table.thesisId],
        foreignColumns: [theses.userId, theses.id],
    }).onDelete("cascade"),
    impactCheck: check("thesis_catalysts_impact_check", sql`${table.impact} in ('high', 'medium', 'low')`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
})).enableRLS();

/** A thesis's evidence, newest first as the user added it. */
export const thesisEvidence = pgTable("thesis_evidence", {
    userId: text("user_id").notNull(),
    thesisId: text("thesis_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    date: text("date").notNull().default(""),
    url: text("url"),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.thesisId, table.id], name: "thesis_evidence_pkey" }),
    thesis: foreignKey({
        name: "thesis_evidence_thesis_fk",
        columns: [table.userId, table.thesisId],
        foreignColumns: [theses.userId, theses.id],
    }).onDelete("cascade"),
    typeCheck: check("thesis_evidence_type_check", sql`${table.type} in ('article', 'report', 'earnings', 'note')`),
    serverOnlyNoClientAccess: serverOnlyNoClientAccessPolicy(),
    appRuntimeAccess: appRuntimeAccessPolicy(),
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

export const securitiesRelations = relations(securities, ({ many }) => ({
    priceBars: many(priceBars),
}));

export const priceBarsRelations = relations(priceBars, ({ one }) => ({
    security: one(securities, {
        fields: [priceBars.symbol],
        references: [securities.symbol],
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
