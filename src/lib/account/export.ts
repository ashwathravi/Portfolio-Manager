/**
 * Building the account export (launch item i65): everything Atlas holds
 * for the user, as they'd recognize it, read in one snapshot. Left out:
 * internal fields (user IDs, write order), removal markers kept only so
 * other devices learn of a deletion, Ask messages already cleared (kept
 * only so they count towards the day's question limit), and anything
 * secret (Plaid tokens, and Plaid's own IDs for connections and accounts).
 */

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import {
    askMessages,
    authUsers,
    holdings,
    journalEntries,
    orderPlans,
    plaidAccounts,
    plaidItems,
    portfolioSnapshotPositions,
    portfolioSnapshots,
    portfolios,
    theses,
    thesisCatalysts,
    thesisEvidence,
    transactions,
    userSettings,
    watchlistItems,
} from "@/db/schema";

import { orderFromRow } from "@/lib/execution/orders";

import { ACCOUNT_EXPORT_FORMAT, ACCOUNT_EXPORT_VERSION, type AccountExport, type ExportedValuationPosition } from "./export-data";

type Database = typeof db;

const INTERNAL = new Set(["userId", "writeSession", "writeSeq", "dismissed", "cleared"]);

/** A row without its internal fields, dates as ISO strings. */
function plain(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(row)
            .filter(([key]) => !INTERNAL.has(key))
            .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    );
}

const num = (value: string | number | null): number | null => (value === null ? null : Number(value));

export async function buildAccountExport(userId: string, database: Database = db, now: Date = new Date()): Promise<AccountExport> {
    return database.transaction(async (tx) => {
        const [user] = await tx.select({ name: authUsers.name, email: authUsers.email }).from(authUsers).where(eq(authUsers.id, userId)).limit(1);
        const [settings] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);

        const accounts = await tx.select().from(portfolios).where(eq(portfolios.userId, userId)).orderBy(asc(portfolios.name), asc(portfolios.id));
        const ids = accounts.map((a) => a.id);
        const [held, activity, history, historyPositions, plans] = ids.length === 0 ? [[], [], [], [], []] : await Promise.all([
            tx.select().from(holdings).where(inArray(holdings.portfolioId, ids)).orderBy(asc(holdings.symbol)),
            tx.select().from(transactions).where(inArray(transactions.portfolioId, ids)).orderBy(asc(transactions.timestamp), asc(transactions.id)),
            tx.select().from(portfolioSnapshots).where(inArray(portfolioSnapshots.portfolioId, ids)).orderBy(asc(portfolioSnapshots.date)),
            tx.select().from(portfolioSnapshotPositions).where(inArray(portfolioSnapshotPositions.portfolioId, ids)).orderBy(asc(portfolioSnapshotPositions.symbol)),
            tx.select().from(orderPlans).where(and(eq(orderPlans.userId, userId), inArray(orderPlans.portfolioId, ids)))
                .orderBy(asc(orderPlans.createdAt), asc(orderPlans.id)),
        ]);
        const positionsOn = new Map<string, ExportedValuationPosition[]>();
        for (const p of historyPositions) {
            const key = `${p.portfolioId}|${p.date}`;
            const day = positionsOn.get(key) ?? [];
            day.push({ symbol: p.symbol, quantity: Number(p.quantity), costBasis: p.costBasis, close: p.close, closeDate: p.closeDate, marketValue: p.marketValue });
            positionsOn.set(key, day);
        }

        const items = await tx
            .select({ id: plaidItems.id, institutionName: plaidItems.institutionName, status: plaidItems.status, createdAt: plaidItems.createdAt })
            .from(plaidItems)
            .where(and(eq(plaidItems.userId, userId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)))
            .orderBy(asc(plaidItems.createdAt));
        const linked = items.length === 0 ? [] : await tx
            .select({
                itemId: plaidAccounts.plaidItemRecordId,
                name: plaidAccounts.name,
                mask: plaidAccounts.mask,
                type: plaidAccounts.type,
                subtype: plaidAccounts.subtype,
                syncStatus: plaidAccounts.syncStatus,
            })
            .from(plaidAccounts)
            .where(and(eq(plaidAccounts.userId, userId), inArray(plaidAccounts.plaidItemRecordId, items.map((i) => i.id))))
            .orderBy(asc(plaidAccounts.name));

        const watchlist = await tx.select().from(watchlistItems)
            .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.dismissed, false))).orderBy(asc(watchlistItems.ticker));
        const journal = await tx.select().from(journalEntries)
            .where(and(eq(journalEntries.userId, userId), eq(journalEntries.dismissed, false))).orderBy(asc(journalEntries.date), asc(journalEntries.id));
        const thesisRows = await tx.select().from(theses)
            .where(and(eq(theses.userId, userId), eq(theses.dismissed, false))).orderBy(asc(theses.ticker), asc(theses.id));
        const [catalysts, evidence] = thesisRows.length === 0 ? [[], []] : await Promise.all([
            tx.select().from(thesisCatalysts).where(eq(thesisCatalysts.userId, userId)).orderBy(asc(thesisCatalysts.position)),
            tx.select().from(thesisEvidence).where(eq(thesisEvidence.userId, userId)).orderBy(asc(thesisEvidence.position)),
        ]);
        const asked = await tx.select().from(askMessages)
            .where(and(eq(askMessages.userId, userId), eq(askMessages.cleared, false))).orderBy(asc(askMessages.createdAt), asc(askMessages.id));

        return {
            format: ACCOUNT_EXPORT_FORMAT,
            version: ACCOUNT_EXPORT_VERSION,
            exportedAt: now.toISOString(),
            profile: { name: user?.name ?? null, email: user?.email ?? null },
            settings: settings ? { version: settings.version, settings: settings.settings, updatedAt: settings.updatedAt.toISOString() } : null,
            accounts: accounts.map((account) => ({
                id: account.id,
                name: account.name,
                description: account.description,
                source: account.source,
                cashBalance: account.cashBalance ?? 0,
                createdAt: account.createdAt.toISOString(),
                updatedAt: account.updatedAt.toISOString(),
                holdings: held.filter((h) => h.portfolioId === account.id).map((h) => ({
                    symbol: h.symbol,
                    name: h.name,
                    quantity: Number(h.quantity),
                    avgCost: Number(h.avgCost),
                    lastPrice: h.currentPrice,
                    updatedAt: h.updatedAt.toISOString(),
                })),
                transactions: activity.filter((t) => t.portfolioId === account.id).map((t) => ({
                    date: t.timestamp.toISOString(),
                    type: t.type,
                    symbol: t.symbol,
                    quantity: num(t.quantity),
                    price: num(t.price),
                    amount: t.amount,
                    fees: num(t.fees),
                    currency: t.currency,
                    notes: t.notes,
                    source: t.source,
                })),
                valuationHistory: history.filter((v) => v.portfolioId === account.id).map((v) => ({
                    date: v.date,
                    totalValue: Number(v.totalValue),
                    holdingsValue: Number(v.holdingsValue),
                    cash: Number(v.cash),
                    costBasis: Number(v.costBasis),
                    positions: positionsOn.get(`${account.id}|${v.date}`) ?? [],
                })),
                orderPlans: plans.filter((p) => p.portfolioId === account.id).map(orderFromRow),
            })),
            linkedConnections: items.map((item) => ({
                institutionName: item.institutionName,
                status: item.status,
                linkedAt: item.createdAt.toISOString(),
                accounts: linked.filter((a) => a.itemId === item.id).map((a) => ({
                    name: a.name,
                    mask: a.mask,
                    type: a.type,
                    subtype: a.subtype,
                    syncing: a.syncStatus === "sync_ready",
                })),
            })),
            watchlist: watchlist.map(plain),
            journal: journal.map(plain),
            theses: thesisRows.map((thesis) => ({
                ...plain(thesis),
                catalysts: catalysts.filter((c) => c.thesisId === thesis.id).map((c) => plain({ ...c, thesisId: undefined })),
                evidence: evidence.filter((e) => e.thesisId === thesis.id).map((e) => plain({ ...e, thesisId: undefined })),
            })),
            askHistory: asked.map(plain),
        };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
