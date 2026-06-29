import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db } from '@/db';
import {
    alphaRadarFilingHoldings,
    alphaRadarHoldingChanges,
    alphaRadarReports,
    alphaRadarSecFilings,
    alphaRadarTrackedFilers,
} from '@/db/schema';
import type {
    AlphaRadarFilingRecord,
    AlphaRadarHoldingRecord,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from './contracts';
import type { AlphaRadarMemoChange } from './memo';
import type { AlphaRadarHoldingChange } from './diff';
import type { AlphaRadarTrackedFilerInput } from '@/lib/validators/alpha-radar';
import type { ParsedThirteenFHolding } from '@/lib/sec';

type AlphaRadarDb = typeof db;

export interface AlphaRadarFilingQuery {
    trackedFilerId?: string;
    reportPeriod?: string;
    limit?: number;
}

export interface AlphaRadarReportQuery {
    trackedFilerId?: string;
    reportPeriod?: string;
    limit?: number;
}

export class DrizzleAlphaRadarDataRepository {
    constructor(private readonly database: AlphaRadarDb = db) {}

    async listTrackedFilers(): Promise<AlphaRadarTrackedFilerRecord[]> {
        const rows = await this.database
            .select()
            .from(alphaRadarTrackedFilers)
            .orderBy(alphaRadarTrackedFilers.name);
        return rows.map(toTrackedFilerRecord);
    }

    async listEnabledTrackedFilers(): Promise<AlphaRadarTrackedFilerRecord[]> {
        const rows = await this.database
            .select()
            .from(alphaRadarTrackedFilers)
            .where(eq(alphaRadarTrackedFilers.enabled, true))
            .orderBy(alphaRadarTrackedFilers.name);
        return rows.map(toTrackedFilerRecord);
    }

    async getTrackedFiler(idOrSlug: string): Promise<AlphaRadarTrackedFilerRecord | null> {
        const [row] = await this.database
            .select()
            .from(alphaRadarTrackedFilers)
            .where(or(eq(alphaRadarTrackedFilers.id, idOrSlug), eq(alphaRadarTrackedFilers.slug, idOrSlug)))
            .limit(1);
        return row ? toTrackedFilerRecord(row) : null;
    }

    async createTrackedFiler(input: AlphaRadarTrackedFilerInput): Promise<AlphaRadarTrackedFilerRecord> {
        const [row] = await this.database
            .insert(alphaRadarTrackedFilers)
            .values({
                ...input,
                secEntityName: input.secEntityName ?? null,
                managerName: input.managerName ?? null,
                fundStyle: input.fundStyle ?? null,
                notes: input.notes ?? null,
                updatedAt: new Date(),
            })
            .returning();
        return toTrackedFilerRecord(row);
    }

    async updateTrackedFiler(
        idOrSlug: string,
        input: Partial<AlphaRadarTrackedFilerInput>,
    ): Promise<AlphaRadarTrackedFilerRecord | null> {
        const filer = await this.getTrackedFiler(idOrSlug);
        if (!filer) return null;

        const [row] = await this.database
            .update(alphaRadarTrackedFilers)
            .set({
                ...input,
                secEntityName: input.secEntityName ?? undefined,
                managerName: input.managerName ?? undefined,
                fundStyle: input.fundStyle ?? undefined,
                notes: input.notes ?? undefined,
                updatedAt: new Date(),
            })
            .where(eq(alphaRadarTrackedFilers.id, filer.id))
            .returning();
        return row ? toTrackedFilerRecord(row) : null;
    }

    async disableTrackedFiler(idOrSlug: string): Promise<AlphaRadarTrackedFilerRecord | null> {
        return this.updateTrackedFiler(idOrSlug, { enabled: false });
    }

    async listFilings(query: AlphaRadarFilingQuery = {}): Promise<AlphaRadarFilingRecord[]> {
        const conditions = [
            query.trackedFilerId ? eq(alphaRadarSecFilings.trackedFilerId, query.trackedFilerId) : undefined,
            query.reportPeriod ? eq(alphaRadarSecFilings.reportPeriod, query.reportPeriod) : undefined,
        ].filter(isDefined);

        const rows = await this.database
            .select()
            .from(alphaRadarSecFilings)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(alphaRadarSecFilings.reportPeriod), desc(alphaRadarSecFilings.filedAt))
            .limit(query.limit ?? 50);
        return rows.map(toFilingRecord);
    }

    async getFiling(id: string): Promise<AlphaRadarFilingRecord | null> {
        const [row] = await this.database
            .select()
            .from(alphaRadarSecFilings)
            .where(eq(alphaRadarSecFilings.id, id))
            .limit(1);
        return row ? toFilingRecord(row) : null;
    }

    async findPriorFiling(input: {
        trackedFilerId: string;
        reportPeriod: string;
    }): Promise<AlphaRadarFilingRecord | null> {
        const [row] = await this.database
            .select()
            .from(alphaRadarSecFilings)
            .where(and(
                eq(alphaRadarSecFilings.trackedFilerId, input.trackedFilerId),
                lt(alphaRadarSecFilings.reportPeriod, input.reportPeriod),
                eq(alphaRadarSecFilings.status, 'parsed'),
            ))
            .orderBy(desc(alphaRadarSecFilings.reportPeriod))
            .limit(1);
        return row ? toFilingRecord(row) : null;
    }

    async replaceFilingHoldings(
        filingId: string,
        holdings: readonly ParsedThirteenFHolding[],
    ): Promise<{ inserted: number }> {
        await this.database
            .delete(alphaRadarFilingHoldings)
            .where(eq(alphaRadarFilingHoldings.filingId, filingId));

        if (holdings.length > 0) {
            await this.database.insert(alphaRadarFilingHoldings).values(holdings.map((holding) => ({
                filingId,
                issuerName: holding.issuerName,
                cusip: holding.cusip,
                ticker: holding.ticker ?? null,
                valueUsd: String(holding.valueUsd),
                shares: String(holding.shares),
                putCall: holding.putCall ?? null,
                securityType: holding.securityType ?? null,
                investmentDiscretion: holding.investmentDiscretion ?? null,
                votingAuthoritySole: optionalNumeric(holding.votingAuthoritySole),
                votingAuthorityShared: optionalNumeric(holding.votingAuthorityShared),
                votingAuthorityNone: optionalNumeric(holding.votingAuthorityNone),
                positionRank: holding.positionRank,
                rawHolding: holding.rawHolding,
            })));
        }

        await this.database
            .update(alphaRadarSecFilings)
            .set({ status: 'parsed', parseError: null, updatedAt: new Date() })
            .where(eq(alphaRadarSecFilings.id, filingId));

        return { inserted: holdings.length };
    }

    async markFilingParseFailed(filingId: string, message: string): Promise<void> {
        await this.database
            .update(alphaRadarSecFilings)
            .set({ status: 'failed', parseError: message, updatedAt: new Date() })
            .where(eq(alphaRadarSecFilings.id, filingId));
    }

    async listHoldingsForFiling(filingId: string): Promise<AlphaRadarHoldingRecord[]> {
        const rows = await this.database
            .select()
            .from(alphaRadarFilingHoldings)
            .where(eq(alphaRadarFilingHoldings.filingId, filingId))
            .orderBy(alphaRadarFilingHoldings.positionRank);
        return rows.map(toHoldingRecord);
    }

    async upsertHoldingChanges(changes: readonly AlphaRadarHoldingChange[]): Promise<AlphaRadarMemoChange[]> {
        if (changes.length === 0) return [];

        const first = changes[0];
        await this.database
            .delete(alphaRadarHoldingChanges)
            .where(and(
                eq(alphaRadarHoldingChanges.trackedFilerId, first.trackedFilerId),
                eq(alphaRadarHoldingChanges.reportPeriod, first.reportPeriod),
            ));

        const rows = await this.database
            .insert(alphaRadarHoldingChanges)
            .values(changes.map((change) => ({
                trackedFilerId: change.trackedFilerId,
                currentFilingId: change.currentFilingId ?? null,
                priorFilingId: change.priorFilingId ?? null,
                reportPeriod: change.reportPeriod,
                changeType: change.changeType,
                issuerName: change.issuerName,
                cusip: change.cusip,
                ticker: change.ticker ?? null,
                currentValueUsd: optionalNumeric(change.currentValueUsd),
                priorValueUsd: optionalNumeric(change.priorValueUsd),
                valueDeltaUsd: optionalNumeric(change.valueDeltaUsd),
                currentShares: optionalNumeric(change.currentShares),
                priorShares: optionalNumeric(change.priorShares),
                shareDelta: optionalNumeric(change.shareDelta),
                currentWeight: change.currentWeight ?? null,
                priorWeight: change.priorWeight ?? null,
                rankDelta: change.rankDelta ?? null,
                materialityScore: change.materialityScore,
                userRelevance: change.userRelevance,
                displayReason: change.displayReason,
            })))
            .returning({ id: alphaRadarHoldingChanges.id, cusip: alphaRadarHoldingChanges.cusip });
        const idsByCusip = new Map(rows.map((row) => [row.cusip, row.id]));
        return changes.map((change) => ({ ...change, id: idsByCusip.get(change.cusip) }));
    }

    async listHoldingChanges(input: {
        trackedFilerId: string;
        reportPeriod?: string;
        limit?: number;
    }): Promise<AlphaRadarMemoChange[]> {
        const conditions = [
            eq(alphaRadarHoldingChanges.trackedFilerId, input.trackedFilerId),
            input.reportPeriod ? eq(alphaRadarHoldingChanges.reportPeriod, input.reportPeriod) : undefined,
        ].filter(isDefined);
        const rows = await this.database
            .select()
            .from(alphaRadarHoldingChanges)
            .where(and(...conditions))
            .orderBy(desc(alphaRadarHoldingChanges.materialityScore), alphaRadarHoldingChanges.issuerName)
            .limit(input.limit ?? 100);
        return rows.map(toMemoChange);
    }

    async listReports(query: AlphaRadarReportQuery = {}): Promise<AlphaRadarReportRecord[]> {
        const conditions = [
            query.trackedFilerId ? eq(alphaRadarReports.trackedFilerId, query.trackedFilerId) : undefined,
            query.reportPeriod ? eq(alphaRadarReports.reportPeriod, query.reportPeriod) : undefined,
        ].filter(isDefined);
        const rows = await this.database
            .select()
            .from(alphaRadarReports)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(alphaRadarReports.reportPeriod), desc(alphaRadarReports.generatedAt))
            .limit(query.limit ?? 20);
        return rows.map(toReportRecord);
    }
}

function toTrackedFilerRecord(row: typeof alphaRadarTrackedFilers.$inferSelect): AlphaRadarTrackedFilerRecord {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        cik: row.cik,
        secEntityName: row.secEntityName,
        managerName: row.managerName,
        fundStyle: row.fundStyle,
        enabled: row.enabled,
        notes: row.notes,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function toFilingRecord(row: typeof alphaRadarSecFilings.$inferSelect): AlphaRadarFilingRecord {
    return {
        id: row.id,
        trackedFilerId: row.trackedFilerId,
        accessionNumber: row.accessionNumber,
        filingType: row.filingType as AlphaRadarFilingRecord['filingType'],
        reportPeriod: row.reportPeriod,
        filedAt: toIso(row.filedAt),
        acceptedAt: toIso(row.acceptedAt),
        primaryDocumentUrl: row.primaryDocumentUrl,
        informationTableUrl: row.informationTableUrl,
        status: row.status,
        parseError: row.parseError,
    };
}

function toHoldingRecord(row: typeof alphaRadarFilingHoldings.$inferSelect): AlphaRadarHoldingRecord {
    return {
        id: row.id,
        filingId: row.filingId,
        issuerName: row.issuerName,
        cusip: row.cusip,
        ticker: row.ticker ?? undefined,
        valueUsd: Number(row.valueUsd),
        shares: Number(row.shares),
        putCall: row.putCall === 'put' || row.putCall === 'call' ? row.putCall : undefined,
        securityType: row.securityType ?? undefined,
        investmentDiscretion: row.investmentDiscretion ?? undefined,
        votingAuthoritySole: optionalNumber(row.votingAuthoritySole),
        votingAuthorityShared: optionalNumber(row.votingAuthorityShared),
        votingAuthorityNone: optionalNumber(row.votingAuthorityNone),
        positionRank: row.positionRank ?? undefined,
        rawHolding: isRecord(row.rawHolding) ? row.rawHolding : undefined,
    };
}

function toMemoChange(row: typeof alphaRadarHoldingChanges.$inferSelect): AlphaRadarMemoChange {
    return {
        id: row.id,
        trackedFilerId: row.trackedFilerId,
        currentFilingId: row.currentFilingId ?? undefined,
        priorFilingId: row.priorFilingId ?? undefined,
        reportPeriod: row.reportPeriod,
        changeType: row.changeType as AlphaRadarMemoChange['changeType'],
        issuerName: row.issuerName,
        cusip: row.cusip,
        ticker: row.ticker ?? undefined,
        currentValueUsd: optionalNumber(row.currentValueUsd),
        priorValueUsd: optionalNumber(row.priorValueUsd),
        valueDeltaUsd: optionalNumber(row.valueDeltaUsd),
        currentShares: optionalNumber(row.currentShares),
        priorShares: optionalNumber(row.priorShares),
        shareDelta: optionalNumber(row.shareDelta),
        currentWeight: row.currentWeight ?? undefined,
        priorWeight: row.priorWeight ?? undefined,
        rankDelta: row.rankDelta ?? undefined,
        materialityScore: row.materialityScore,
        userRelevance: isRecord(row.userRelevance)
            ? row.userRelevance as AlphaRadarMemoChange['userRelevance']
            : {
                portfolio: false,
                watchlist: false,
                thesis: false,
                reasons: [],
                matchedTickers: [],
                matchedCusips: [],
            },
        displayReason: row.displayReason ?? '',
    };
}

function toReportRecord(row: typeof alphaRadarReports.$inferSelect): AlphaRadarReportRecord {
    return {
        id: row.id,
        trackedFilerId: row.trackedFilerId,
        filingId: row.filingId ?? undefined,
        reportPeriod: row.reportPeriod,
        status: row.status as AlphaRadarReportRecord['status'],
        title: row.title,
        summary: row.summary,
        sections: Array.isArray(row.sections) ? row.sections as AlphaRadarReportRecord['sections'] : [],
        markdown: row.markdown,
        sourceFilingIds: Array.isArray(row.sourceFilingIds) ? row.sourceFilingIds as string[] : [],
        generatorVersion: row.generatorVersion,
        generatedAt: toIso(row.generatedAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function optionalNumeric(value: number | undefined): string | null {
    return value === undefined ? null : String(value);
}

function optionalNumber(value: string | null | undefined): number | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function toIso(value: Date | null | undefined): string | undefined {
    return value ? value.toISOString() : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
