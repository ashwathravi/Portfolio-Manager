import { SecEdgarClient, AlphaRadarSecIngestionService, DrizzleSecFilingRepository } from '@/lib/sec';
import { DrizzleAlphaRadarReportRepository } from './report-repository';
import { DrizzleAlphaRadarDataRepository } from './repository';
import { AlphaRadarRefreshService } from './refresh';

export function getAlphaRadarDataRepository() {
    return new DrizzleAlphaRadarDataRepository();
}

export function getAlphaRadarRefreshService() {
    const secRepository = new DrizzleSecFilingRepository();
    return new AlphaRadarRefreshService({
        secIngestion: new AlphaRadarSecIngestionService(new SecEdgarClient(), secRepository),
        repository: new DrizzleAlphaRadarDataRepository(),
        reportRepository: new DrizzleAlphaRadarReportRepository(),
        filingLimit: 3,
    });
}
