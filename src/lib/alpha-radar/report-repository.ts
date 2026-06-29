import { db } from '@/db';
import { alphaRadarReports } from '@/db/schema';
import type { AlphaRadarReportInput } from '@/lib/validators/alpha-radar';

type AlphaRadarDb = typeof db;

export interface StoredAlphaRadarReport {
    id: string;
    reportPeriod: string;
    generatorVersion: string;
}

export class DrizzleAlphaRadarReportRepository {
    constructor(private readonly database: AlphaRadarDb = db) {}

    async upsertReport(report: AlphaRadarReportInput): Promise<StoredAlphaRadarReport> {
        const [stored] = await this.database
            .insert(alphaRadarReports)
            .values({
                trackedFilerId: report.trackedFilerId,
                filingId: report.filingId ?? null,
                reportPeriod: report.reportPeriod,
                status: report.status,
                title: report.title,
                summary: report.summary,
                sections: report.sections,
                markdown: report.markdown,
                sourceFilingIds: report.sourceFilingIds,
                generatorVersion: report.generatorVersion,
                generatedAt: new Date(),
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [
                    alphaRadarReports.trackedFilerId,
                    alphaRadarReports.reportPeriod,
                    alphaRadarReports.generatorVersion,
                ],
                set: {
                    filingId: report.filingId ?? null,
                    status: report.status,
                    title: report.title,
                    summary: report.summary,
                    sections: report.sections,
                    markdown: report.markdown,
                    sourceFilingIds: report.sourceFilingIds,
                    generatedAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            .returning({
                id: alphaRadarReports.id,
                reportPeriod: alphaRadarReports.reportPeriod,
                generatorVersion: alphaRadarReports.generatorVersion,
            });

        return stored;
    }
}
