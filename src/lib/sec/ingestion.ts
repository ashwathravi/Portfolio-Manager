import { alphaRadarCikSchema } from '@/lib/validators/alpha-radar';
import {
    SecEdgarError,
    type SecFilingMetadata,
    type SecFilingRepository,
    type SecRefreshAllResult,
    type SecRefreshFilerResult,
    type SecTrackedFilerRef,
    type StoredSecFiling,
} from './types';

export interface SecIngestionClient {
    resolveCik(query: string): Promise<{ cik: string }>;
    fetchRecent13FFilings(input: {
        trackedFilerId: string;
        cik: string;
        limit?: number;
    }): Promise<SecFilingMetadata[]>;
}

export interface SecIngestionOptions {
    filingLimit?: number;
}

export class AlphaRadarSecIngestionService {
    constructor(
        private readonly client: SecIngestionClient,
        private readonly repository: SecFilingRepository,
    ) {}

    async refreshFiler(filer: SecTrackedFilerRef, options: SecIngestionOptions = {}): Promise<SecRefreshFilerResult> {
        const cik = await this.resolveFilerCik(filer);
        const filings = await this.client.fetchRecent13FFilings({
            trackedFilerId: filer.id,
            cik,
            limit: options.filingLimit,
        });

        const storedFilings: StoredSecFiling[] = [];
        for (const filing of filings) {
            storedFilings.push(await this.repository.upsertFiling(filing));
        }

        const created = storedFilings.filter((filing) => filing.created).length;

        return {
            trackedFilerId: filer.id,
            cik,
            fetched: filings.length,
            stored: storedFilings.length,
            created,
            unchanged: storedFilings.length - created,
            filings: storedFilings,
        };
    }

    async refreshAllFilers(options: SecIngestionOptions = {}): Promise<SecRefreshAllResult> {
        const filers = await this.repository.listEnabledTrackedFilers();
        const succeeded: SecRefreshFilerResult[] = [];
        const failed: SecRefreshAllResult['failed'] = [];

        for (const filer of filers) {
            try {
                succeeded.push(await this.refreshFiler(filer, options));
            } catch (error) {
                failed.push({
                    trackedFilerId: filer.id,
                    message: error instanceof Error ? error.message : 'Unknown SEC refresh error',
                    code: error instanceof SecEdgarError ? error.code : undefined,
                });
            }
        }

        return {
            totalFilers: filers.length,
            succeeded,
            failed,
        };
    }

    private async resolveFilerCik(filer: SecTrackedFilerRef): Promise<string> {
        if (filer.cik) return alphaRadarCikSchema.parse(filer.cik);

        const match = await this.client.resolveCik(filer.name);
        return alphaRadarCikSchema.parse(match.cik);
    }
}
