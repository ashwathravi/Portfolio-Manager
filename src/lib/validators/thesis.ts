import { z } from 'zod';

import { importPositionFields, recordIdSchema, writeOrderSchema } from '@/lib/validators/research-ids';

/**
 * Theses as the browser sends them (launch item i38): one, with its
 * catalysts and evidence, to PUT /api/research/theses/[id], or this
 * browser's theses to import once.
 */

export const THESIS_LIMITS = {
    ticker: 20,
    companyName: 200,
    title: 200,
    description: 5000,
    timeHorizon: 50,
    tags: 20,
    tag: 40,
    hypothesis: 5000,
    cases: 20,
    caseItem: 1000,
    catalysts: 50,
    evidence: 50,
    itemTitle: 200,
    itemDate: 40,
    url: 2000,
} as const;
export const THESIS_IMPORT_MAX = 200;

// Printable text: no control characters.
const NO_CONTROL = /^[^\p{Cc}]*$/u;

const shortText = (max: number, name: string) =>
    z.string().trim().max(max, `${name} must be at most ${max} characters`).regex(NO_CONTROL, `${name} must be printable text`);

/** A link the app may render: http or https only. */
const urlSchema = z.string().trim()
    .max(THESIS_LIMITS.url, `url must be at most ${THESIS_LIMITS.url} characters`)
    .refine((value) => {
        try {
            const { protocol } = new URL(value);
            return protocol === 'https:' || protocol === 'http:';
        } catch {
            return false;
        }
    }, 'url must be an http or https link');

export const thesisCatalystSchema = z.object({
    id: recordIdSchema,
    title: shortText(THESIS_LIMITS.itemTitle, 'catalyst title').min(1, 'catalyst title is required'),
    // Free text, as the form takes it: "2026-05-01", "Q2 2026", "Monthly".
    date: shortText(THESIS_LIMITS.itemDate, 'catalyst date'),
    impact: z.enum(['high', 'medium', 'low'], { message: 'impact must be high, medium or low' }),
}).strict();

export const thesisEvidenceSchema = z.object({
    id: recordIdSchema,
    title: shortText(THESIS_LIMITS.itemTitle, 'evidence title').min(1, 'evidence title is required'),
    type: z.enum(['article', 'report', 'earnings', 'note'], { message: 'evidence type must be article, report, earnings or note' }),
    date: shortText(THESIS_LIMITS.itemDate, 'evidence date'),
    url: urlSchema.nullable(),
}).strict();

const caseList = (name: string) => z.array(
    z.string().trim().min(1, `${name} items can't be empty`).max(THESIS_LIMITS.caseItem, `${name} items must be at most ${THESIS_LIMITS.caseItem} characters`),
).max(THESIS_LIMITS.cases, `at most ${THESIS_LIMITS.cases} ${name} items`);

export const thesisSchema = z.object({
    id: recordIdSchema,
    ticker: shortText(THESIS_LIMITS.ticker, 'ticker').min(1, 'ticker is required'),
    companyName: shortText(THESIS_LIMITS.companyName, 'companyName'),
    title: shortText(THESIS_LIMITS.title, 'title').min(1, 'title is required'),
    description: z.string().trim().max(THESIS_LIMITS.description, `description must be at most ${THESIS_LIMITS.description} characters`),
    type: z.enum(['bull', 'bear'], { message: 'type must be bull or bear' }),
    status: z.enum(['active', 'monitoring', 'archived'], { message: 'status must be active, monitoring or archived' }),
    conviction: z.enum(['HIGH', 'MEDIUM', 'LOW'], { message: 'conviction must be HIGH, MEDIUM or LOW' }),
    targetPrice: z.number().finite().min(0, 'targetPrice must be 0 or more'),
    currentPrice: z.number().finite().min(0, 'currentPrice must be 0 or more').nullable(),
    timeHorizon: shortText(THESIS_LIMITS.timeHorizon, 'timeHorizon'),
    dateCreated: z.iso.date({ message: 'dateCreated must be a date (YYYY-MM-DD)' }),
    dateUpdated: z.iso.date({ message: 'dateUpdated must be a date (YYYY-MM-DD)' }),
    tags: z.array(shortText(THESIS_LIMITS.tag, 'tag').min(1, "tags can't be empty")).max(THESIS_LIMITS.tags, `at most ${THESIS_LIMITS.tags} tags`),
    hypothesis: z.string().trim().max(THESIS_LIMITS.hypothesis, `hypothesis must be at most ${THESIS_LIMITS.hypothesis} characters`),
    bullCase: caseList('bull case'),
    bearCase: caseList('bear case'),
    catalysts: z.array(thesisCatalystSchema).max(THESIS_LIMITS.catalysts, `at most ${THESIS_LIMITS.catalysts} catalysts`),
    linkedEvidence: z.array(thesisEvidenceSchema).max(THESIS_LIMITS.evidence, `at most ${THESIS_LIMITS.evidence} pieces of evidence`),
    healthScore: z.number().int('healthScore must be a whole number').min(0, 'healthScore must be 0 to 100').max(100, 'healthScore must be 0 to 100'),
    // Deleted: an example, kept so it isn't shown again, or the user's own,
    // kept (with its text cleared) so a late save can't bring it back.
    dismissed: z.boolean().default(false),
}).strict()
    .refine((thesis) => new Set(thesis.catalysts.map((c) => c.id)).size === thesis.catalysts.length, 'catalyst ids must be unique')
    .refine((thesis) => new Set(thesis.linkedEvidence.map((e) => e.id)).size === thesis.linkedEvidence.length, 'evidence ids must be unique');

export type ThesisInput = z.infer<typeof thesisSchema>;

/**
 * PUT /api/research/theses/[id]: the thesis, and the order of the write.
 * Deleting a thesis is a PUT with `dismissed: true`.
 */
export const thesisPutSchema = z.object({
    thesis: thesisSchema,
    order: writeOrderSchema,
}).strict();

/**
 * The PUT route's body limit: room for the largest thesis the schema allows,
 * with every character JSON-escaped (6 bytes each). Bodies this big are sent
 * without keepalive, which browsers cap at 64 KiB.
 */
export const THESIS_PUT_MAX_BYTES = 2 * 1024 * 1024;

/** POST /api/research/theses/import: one batch of a browser's theses. */
export const thesisImportSchema = z.object({
    items: z.array(thesisSchema).max(THESIS_IMPORT_MAX, `at most ${THESIS_IMPORT_MAX} theses`),
    ...importPositionFields,
}).strict();
