import { SecEdgarClient, AlphaRadarSecIngestionService, DrizzleSecFilingRepository } from '@/lib/sec';
import { alphaRadarEmbeddingProvider } from './embeddings';
import { DrizzleAlphaRadarSemanticMemoryRepository } from './memory-repository';
import { DrizzleAlphaRadarReportRepository } from './report-repository';
import { DrizzleAlphaRadarDataRepository } from './repository';
import { AlphaRadarRefreshService, defaultFetchInformationTableXml } from './refresh';

export function getAlphaRadarDataRepository() {
    return new DrizzleAlphaRadarDataRepository();
}

/** With `signal`, every SEC request stops once it aborts (the daily job's deadline). */
export function getAlphaRadarRefreshService({ signal }: { signal?: AbortSignal } = {}) {
    const secRepository = new DrizzleSecFilingRepository();
    return new AlphaRadarRefreshService({
        secIngestion: new AlphaRadarSecIngestionService(new SecEdgarClient({ signal }), secRepository),
        repository: new DrizzleAlphaRadarDataRepository(),
        reportRepository: new DrizzleAlphaRadarReportRepository(),
        fetchInformationTableXml: (filing) => defaultFetchInformationTableXml(filing, signal),
        filingLimit: 3,
        memory: new DrizzleAlphaRadarSemanticMemoryRepository(),
        embeddings: alphaRadarEmbeddingProvider(),
    });
}
