import { buildAlphaRadarReportMemoryChunks } from './memory';
import type { AlphaRadarReportRecord, AlphaRadarTrackedFilerRecord } from './contracts';

export const ALPHA_RADAR_DEMO_MEMORY_FILER: AlphaRadarTrackedFilerRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Berkshire Hathaway',
    slug: 'berkshire-hathaway',
    cik: '0001067983',
    managerName: 'Warren Buffett',
    fundStyle: 'Concentrated value',
    enabled: true,
};

export const ALPHA_RADAR_DEMO_MEMORY_REPORT: AlphaRadarReportRecord = {
    id: '55555555-5555-4555-8555-555555555555',
    trackedFilerId: ALPHA_RADAR_DEMO_MEMORY_FILER.id,
    filingId: '33333333-3333-4333-8333-333333333333',
    reportPeriod: '2025-Q4',
    status: 'generated',
    title: 'Berkshire Hathaway Alpha Radar 2025-Q4',
    summary: 'Berkshire added AI infrastructure exposure while trimming lower-conviction energy holdings.',
    sections: [
        {
            id: 'summary',
            title: 'Summary',
            kind: 'summary',
            markdown: 'Berkshire added Apple (AAPL) and Nvidia (NVDA) exposure in 2025-Q4. The memo flags AI infrastructure and portfolio overlap as the dominant research themes.',
            changeIds: [],
        },
        {
            id: 'watch-next',
            title: 'Watch next',
            kind: 'watch_next',
            markdown: '- Re-check NVDA after the next 13F and earnings transcript.\n- Compare AAPL position size against existing Portfolio Manager holdings.',
            changeIds: [],
        },
        {
            id: 'risks',
            title: 'Caveats',
            kind: 'risks',
            markdown: '13F data is delayed and excludes short positions. Treat this as evidence for research recall, not a trading recommendation.',
            changeIds: [],
        },
    ],
    markdown: '',
    sourceFilingIds: ['33333333-3333-4333-8333-333333333333'],
    generatorVersion: 'deterministic-v1',
};

export const ALPHA_RADAR_DEMO_MEMORY_CHUNKS = buildAlphaRadarReportMemoryChunks({
    report: ALPHA_RADAR_DEMO_MEMORY_REPORT,
    filer: ALPHA_RADAR_DEMO_MEMORY_FILER,
});
