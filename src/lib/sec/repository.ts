import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { alphaRadarSecFilings, alphaRadarTrackedFilers } from '@/db/schema';
import type { SecFilingMetadata, SecFilingRepository, SecTrackedFilerRef, StoredSecFiling } from './types';

type AlphaRadarDb = typeof db;

export class DrizzleSecFilingRepository implements SecFilingRepository {
    constructor(private readonly database: AlphaRadarDb = db) {}

    async listEnabledTrackedFilers(): Promise<SecTrackedFilerRef[]> {
        return this.database
            .select({
                id: alphaRadarTrackedFilers.id,
                name: alphaRadarTrackedFilers.name,
                cik: alphaRadarTrackedFilers.cik,
            })
            .from(alphaRadarTrackedFilers)
            .where(eq(alphaRadarTrackedFilers.enabled, true));
    }

    async upsertFiling(filing: SecFilingMetadata): Promise<StoredSecFiling> {
        const existing = await this.database
            .select({
                id: alphaRadarSecFilings.id,
                accessionNumber: alphaRadarSecFilings.accessionNumber,
                reportPeriod: alphaRadarSecFilings.reportPeriod,
                filingType: alphaRadarSecFilings.filingType,
            })
            .from(alphaRadarSecFilings)
            .where(eq(alphaRadarSecFilings.accessionNumber, filing.accessionNumber))
            .limit(1);

        const [stored] = await this.database
            .insert(alphaRadarSecFilings)
            .values({
                trackedFilerId: filing.trackedFilerId,
                cik: filing.cik,
                accessionNumber: filing.accessionNumber,
                filingType: filing.filingType,
                reportPeriod: filing.reportPeriod,
                filedAt: filing.filedAt ? new Date(filing.filedAt) : null,
                acceptedAt: filing.acceptedAt ? new Date(filing.acceptedAt) : null,
                primaryDocumentUrl: filing.primaryDocumentUrl ?? null,
                informationTableUrl: filing.informationTableUrl ?? null,
                status: filing.status,
                rawSubmission: filing.rawSubmission,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [
                    alphaRadarSecFilings.trackedFilerId,
                    alphaRadarSecFilings.reportPeriod,
                    alphaRadarSecFilings.filingType,
                ],
                set: {
                    cik: filing.cik,
                    accessionNumber: filing.accessionNumber,
                    filedAt: filing.filedAt ? new Date(filing.filedAt) : null,
                    acceptedAt: filing.acceptedAt ? new Date(filing.acceptedAt) : null,
                    primaryDocumentUrl: filing.primaryDocumentUrl ?? null,
                    informationTableUrl: filing.informationTableUrl ?? null,
                    status: filing.status,
                    rawSubmission: filing.rawSubmission,
                    updatedAt: new Date(),
                },
            })
            .returning({
                id: alphaRadarSecFilings.id,
                trackedFilerId: alphaRadarSecFilings.trackedFilerId,
                accessionNumber: alphaRadarSecFilings.accessionNumber,
                reportPeriod: alphaRadarSecFilings.reportPeriod,
                filingType: alphaRadarSecFilings.filingType,
                primaryDocumentUrl: alphaRadarSecFilings.primaryDocumentUrl,
                informationTableUrl: alphaRadarSecFilings.informationTableUrl,
            });

        return {
            id: stored.id,
            trackedFilerId: stored.trackedFilerId,
            accessionNumber: stored.accessionNumber,
            reportPeriod: stored.reportPeriod,
            filingType: stored.filingType as StoredSecFiling['filingType'],
            primaryDocumentUrl: stored.primaryDocumentUrl,
            informationTableUrl: stored.informationTableUrl,
            created: existing.length === 0,
        };
    }
}
