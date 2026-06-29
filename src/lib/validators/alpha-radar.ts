import { z } from 'zod';
import { noHtmlTags, noStartingEquals } from './common';

const SAFE_TEXT_ERROR = 'Input contains invalid characters (< or >)';
const FORMULA_ERROR = 'Input cannot start with =';

function safeTrimmedText(label: string, max = 200) {
    return z.string()
        .trim()
        .min(1, `${label} is required`)
        .max(max, `${label} is too long`)
        .refine(noHtmlTags, { message: SAFE_TEXT_ERROR })
        .refine(noStartingEquals, { message: FORMULA_ERROR });
}

export const alphaRadarReportPeriodSchema = z.string()
    .regex(/^\d{4}-Q[1-4]$/, 'Report period must use YYYY-QN format');

export const alphaRadarCikSchema = z.string()
    .trim()
    .regex(/^\d{1,10}$/, 'CIK must contain 1 to 10 digits')
    .transform((cik) => cik.padStart(10, '0'));

export const alphaRadarAccessionSchema = z.string()
    .trim()
    .regex(/^\d{10}-\d{2}-\d{6}$/, 'Accession number must use SEC dashed format');

export const alphaRadarCusipSchema = z.string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{9}$/, 'CUSIP must be 9 alphanumeric characters');

export const alphaRadarTickerSchema = z.string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.-]{0,9}$/, 'Ticker contains invalid characters');

export const alphaRadarFilingTypeSchema = z.enum(['13F-HR', '13F-HR/A']);
export const alphaRadarFilingStatusSchema = z.enum(['discovered', 'fetched', 'parsed', 'failed', 'skipped']);
export const alphaRadarChangeTypeSchema = z.enum(['new', 'exited', 'increased', 'decreased', 'unchanged', 'amended']);
export const alphaRadarReportStatusSchema = z.enum(['generated', 'stale', 'failed']);
export const alphaRadarPutCallSchema = z.enum(['put', 'call']).optional();
export const alphaRadarListLimitSchema = z.coerce.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(250, 'Limit cannot exceed 250');

export const alphaRadarRefreshRequestSchema = z.object({
    force: z.boolean().optional(),
    filingLimit: z.number()
        .int('Filing limit must be an integer')
        .min(1, 'Filing limit must be at least 1')
        .max(20, 'Filing limit cannot exceed 20')
        .optional(),
});

export const alphaRadarMemorySearchQuerySchema = z.object({
    query: z.string()
        .trim()
        .max(200, 'Search query is too long')
        .refine(noHtmlTags, { message: SAFE_TEXT_ERROR })
        .refine(noStartingEquals, { message: FORMULA_ERROR }),
    limit: z.coerce.number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(25, 'Limit cannot exceed 25')
        .default(5),
    trackedFilerId: z.string().uuid('Tracked filer id must be a UUID').optional(),
    reportPeriod: alphaRadarReportPeriodSchema.optional(),
});

export const alphaRadarUserRelevanceSchema = z.object({
    portfolio: z.boolean().default(false),
    watchlist: z.boolean().default(false),
    thesis: z.boolean().default(false),
    reasons: z.array(safeTrimmedText('Relevance reason', 200)).default([]),
    matchedTickers: z.array(alphaRadarTickerSchema).default([]),
    matchedCusips: z.array(alphaRadarCusipSchema).default([]),
});

const nonNegativeMoneySchema = z.number()
    .finite('Value must be finite')
    .min(0, 'Value must be non-negative');

const nonNegativeQuantitySchema = z.number()
    .finite('Quantity must be finite')
    .min(0, 'Quantity must be non-negative');

const weightSchema = z.number()
    .finite('Weight must be finite')
    .min(0, 'Weight must be non-negative')
    .max(1, 'Weight must be a fraction between 0 and 1');

export const alphaRadarTrackedFilerSchema = z.object({
    name: safeTrimmedText('Filer name'),
    slug: z.string()
        .trim()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case'),
    cik: alphaRadarCikSchema,
    secEntityName: safeTrimmedText('SEC entity name').optional(),
    managerName: safeTrimmedText('Manager name').optional(),
    fundStyle: safeTrimmedText('Fund style', 80).optional(),
    enabled: z.boolean().default(true),
    notes: safeTrimmedText('Notes', 500).optional(),
});

export const alphaRadarTrackedFilerListSchema = z.array(alphaRadarTrackedFilerSchema)
    .min(1, 'At least one tracked filer is required')
    .superRefine((filers, ctx) => {
        const seenSlugs = new Map<string, number>();
        const seenCiks = new Map<string, number>();

        filers.forEach((filer, index) => {
            const slugHit = seenSlugs.get(filer.slug);
            if (slugHit !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: [index, 'slug'],
                    message: `Duplicate tracked filer slug also used at index ${slugHit}`,
                });
            }
            seenSlugs.set(filer.slug, index);

            const cikHit = seenCiks.get(filer.cik);
            if (cikHit !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: [index, 'cik'],
                    message: `Duplicate tracked filer CIK also used at index ${cikHit}`,
                });
            }
            seenCiks.set(filer.cik, index);
        });
    });

export const alphaRadarSecFilingSchema = z.object({
    trackedFilerId: z.string().uuid('Tracked filer id must be a UUID'),
    cik: alphaRadarCikSchema,
    accessionNumber: alphaRadarAccessionSchema,
    filingType: alphaRadarFilingTypeSchema,
    reportPeriod: alphaRadarReportPeriodSchema,
    filedAt: z.string().datetime().optional(),
    acceptedAt: z.string().datetime().optional(),
    primaryDocumentUrl: z.string().url().optional(),
    informationTableUrl: z.string().url().optional(),
    status: alphaRadarFilingStatusSchema.default('discovered'),
});

export const alphaRadarSecFilingBatchSchema = z.array(alphaRadarSecFilingSchema)
    .superRefine((filings, ctx) => {
        const accessions = new Map<string, number>();
        const filerPeriods = new Map<string, number>();

        filings.forEach((filing, index) => {
            const accessionHit = accessions.get(filing.accessionNumber);
            if (accessionHit !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: [index, 'accessionNumber'],
                    message: `Duplicate accession number also used at index ${accessionHit}`,
                });
            }
            accessions.set(filing.accessionNumber, index);

            const filerPeriodKey = `${filing.trackedFilerId}:${filing.reportPeriod}:${filing.filingType}`;
            const filerPeriodHit = filerPeriods.get(filerPeriodKey);
            if (filerPeriodHit !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: [index, 'reportPeriod'],
                    message: `Duplicate filer/period/type also used at index ${filerPeriodHit}`,
                });
            }
            filerPeriods.set(filerPeriodKey, index);
        });
    });

export const alphaRadarFilingHoldingSchema = z.object({
    filingId: z.string().uuid('Filing id must be a UUID'),
    issuerName: safeTrimmedText('Issuer name'),
    cusip: alphaRadarCusipSchema,
    ticker: alphaRadarTickerSchema.optional(),
    valueUsd: nonNegativeMoneySchema,
    shares: nonNegativeQuantitySchema,
    putCall: alphaRadarPutCallSchema,
    securityType: safeTrimmedText('Security type', 80).optional(),
    investmentDiscretion: safeTrimmedText('Investment discretion', 80).optional(),
    votingAuthoritySole: nonNegativeQuantitySchema.optional(),
    votingAuthorityShared: nonNegativeQuantitySchema.optional(),
    votingAuthorityNone: nonNegativeQuantitySchema.optional(),
    positionRank: z.number().int().positive().optional(),
});

export const alphaRadarHoldingChangeSchema = z.object({
    trackedFilerId: z.string().uuid('Tracked filer id must be a UUID'),
    currentFilingId: z.string().uuid('Current filing id must be a UUID').optional(),
    priorFilingId: z.string().uuid('Prior filing id must be a UUID').optional(),
    reportPeriod: alphaRadarReportPeriodSchema,
    changeType: alphaRadarChangeTypeSchema,
    issuerName: safeTrimmedText('Issuer name'),
    cusip: alphaRadarCusipSchema,
    ticker: alphaRadarTickerSchema.optional(),
    currentValueUsd: nonNegativeMoneySchema.optional(),
    priorValueUsd: nonNegativeMoneySchema.optional(),
    valueDeltaUsd: z.number().finite('Value delta must be finite').optional(),
    currentShares: nonNegativeQuantitySchema.optional(),
    priorShares: nonNegativeQuantitySchema.optional(),
    shareDelta: z.number().finite('Share delta must be finite').optional(),
    currentWeight: weightSchema.optional(),
    priorWeight: weightSchema.optional(),
    rankDelta: z.number().int().optional(),
    materialityScore: z.number()
        .finite('Materiality score must be finite')
        .min(0, 'Materiality score must be non-negative')
        .default(0),
    userRelevance: alphaRadarUserRelevanceSchema.optional(),
    displayReason: safeTrimmedText('Display reason', 500).optional(),
}).superRefine((change, ctx) => {
    if ((change.changeType === 'new' || change.changeType === 'increased' || change.changeType === 'unchanged' || change.changeType === 'amended') && change.currentValueUsd === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['currentValueUsd'],
            message: `${change.changeType} changes require a current value`,
        });
    }

    if ((change.changeType === 'exited' || change.changeType === 'decreased' || change.changeType === 'unchanged' || change.changeType === 'amended') && change.priorValueUsd === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['priorValueUsd'],
            message: `${change.changeType} changes require a prior value`,
        });
    }
});

export const alphaRadarReportSectionSchema = z.object({
    id: z.string().trim().min(1, 'Section id is required'),
    title: safeTrimmedText('Section title'),
    kind: z.enum(['summary', 'top_adds', 'trims', 'exits', 'new_positions', 'overlap', 'watch_next', 'risks']),
    markdown: safeTrimmedText('Section markdown', 5000),
    changeIds: z.array(z.string().uuid()).default([]),
});

export const alphaRadarReportSchema = z.object({
    trackedFilerId: z.string().uuid('Tracked filer id must be a UUID'),
    filingId: z.string().uuid('Filing id must be a UUID').optional(),
    reportPeriod: alphaRadarReportPeriodSchema,
    status: alphaRadarReportStatusSchema.default('generated'),
    title: safeTrimmedText('Report title'),
    summary: safeTrimmedText('Report summary', 1000),
    sections: z.array(alphaRadarReportSectionSchema).min(1, 'At least one report section is required'),
    markdown: safeTrimmedText('Report markdown', 10000),
    sourceFilingIds: z.array(z.string().uuid()).min(1, 'At least one source filing is required'),
    generatorVersion: z.string().trim().min(1).default('deterministic-v1'),
});

export type AlphaRadarTrackedFilerInput = z.infer<typeof alphaRadarTrackedFilerSchema>;
export type AlphaRadarSecFilingInput = z.infer<typeof alphaRadarSecFilingSchema>;
export type AlphaRadarFilingHoldingInput = z.infer<typeof alphaRadarFilingHoldingSchema>;
export type AlphaRadarHoldingChangeInput = z.infer<typeof alphaRadarHoldingChangeSchema>;
export type AlphaRadarReportInput = z.infer<typeof alphaRadarReportSchema>;
export type AlphaRadarUserRelevanceInput = z.infer<typeof alphaRadarUserRelevanceSchema>;
