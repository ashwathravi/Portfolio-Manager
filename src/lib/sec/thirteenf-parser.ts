import { alphaRadarFilingHoldingSchema, alphaRadarReportPeriodSchema } from '@/lib/validators/alpha-radar';

export type CusipTickerResolver = Record<string, string> | ((cusip: string, issuerName: string) => string | undefined);

export interface ParseThirteenFContext {
    filingId: string;
    accessionNumber: string;
    filerName?: string;
    reportPeriod?: string;
    tickerByCusip?: CusipTickerResolver;
}

export interface ParsedThirteenFHolding {
    filingId: string;
    issuerName: string;
    cusip: string;
    ticker?: string;
    valueUsd: number;
    shares: number;
    putCall?: 'put' | 'call';
    securityType?: string;
    investmentDiscretion?: string;
    votingAuthoritySole?: number;
    votingAuthorityShared?: number;
    votingAuthorityNone?: number;
    positionRank: number;
    rawHolding: Record<string, unknown>;
}

export interface ParseThirteenFResult {
    filingId: string;
    accessionNumber: string;
    filerName?: string;
    reportPeriod?: string;
    holdings: ParsedThirteenFHolding[];
    totalValueUsd: number;
}

export class ThirteenFParseError extends Error {
    readonly accessionNumber: string;
    readonly filerName?: string;
    readonly field?: string;
    readonly rowIndex?: number;

    constructor(
        message: string,
        context: ParseThirteenFContext,
        details: { field?: string; rowIndex?: number } = {},
    ) {
        const location = [
            `accession ${context.accessionNumber}`,
            context.filerName ? `filer ${context.filerName}` : null,
            details.rowIndex !== undefined ? `row ${details.rowIndex + 1}` : null,
            details.field ? `field ${details.field}` : null,
        ].filter(Boolean).join(', ');

        super(`${message} (${location})`);
        this.name = 'ThirteenFParseError';
        this.accessionNumber = context.accessionNumber;
        this.filerName = context.filerName;
        this.field = details.field;
        this.rowIndex = details.rowIndex;
    }
}

export function parseThirteenFInformationTable(xml: string, context: ParseThirteenFContext): ParseThirteenFResult {
    if (context.reportPeriod) {
        alphaRadarReportPeriodSchema.parse(context.reportPeriod);
    }

    const blocks = extractTagBlocks(xml, 'infoTable');
    if (blocks.length === 0) {
        const hasPartialInfoTable = /<(?:[A-Za-z0-9_.-]+:)?infoTable\b/i.test(xml);
        throw new ThirteenFParseError(
            hasPartialInfoTable
                ? 'Malformed 13F XML: found an opening infoTable tag without a complete closing tag'
                : 'No infoTable rows found in 13F XML',
            context,
        );
    }

    const parsed = blocks.map((block, rowIndex) => parseHoldingBlock(block, context, rowIndex));
    const holdings = rankHoldings(parsed);

    return {
        filingId: context.filingId,
        accessionNumber: context.accessionNumber,
        filerName: context.filerName,
        reportPeriod: context.reportPeriod,
        holdings,
        totalValueUsd: holdings.reduce((sum, holding) => sum + holding.valueUsd, 0),
    };
}

function parseHoldingBlock(block: string, context: ParseThirteenFContext, rowIndex: number): ParsedThirteenFHolding {
    const issuerName = requireText(block, 'nameOfIssuer', context, rowIndex);
    const cusip = requireText(block, 'cusip', context, rowIndex).toUpperCase();
    const valueRaw = requireText(block, 'value', context, rowIndex);
    const sharesRaw = requireText(block, 'sshPrnamt', context, rowIndex);
    const securityType = optionalText(block, 'titleOfClass');
    const investmentDiscretion = optionalText(block, 'investmentDiscretion');
    const putCall = normalizePutCall(optionalText(block, 'putCall'), context, rowIndex);
    const valueThousands = parseNonNegativeNumber(valueRaw, 'value', context, rowIndex);
    const shares = parseNonNegativeNumber(sharesRaw, 'sshPrnamt', context, rowIndex);
    const votingAuthority = extractFirstTagBlock(block, 'votingAuthority');

    const holding: ParsedThirteenFHolding = {
        filingId: context.filingId,
        issuerName,
        cusip,
        ticker: resolveTicker(context.tickerByCusip, cusip, issuerName),
        valueUsd: valueThousands * 1000,
        shares,
        putCall,
        securityType,
        investmentDiscretion,
        votingAuthoritySole: parseOptionalNonNegativeNumber(votingAuthority, 'Sole', context, rowIndex),
        votingAuthorityShared: parseOptionalNonNegativeNumber(votingAuthority, 'Shared', context, rowIndex),
        votingAuthorityNone: parseOptionalNonNegativeNumber(votingAuthority, 'None', context, rowIndex),
        positionRank: rowIndex + 1,
        rawHolding: {
            sourceIndex: rowIndex,
            nameOfIssuer: issuerName,
            titleOfClass: securityType,
            cusip,
            rawValue: valueRaw,
            valueUnit: 'thousands_usd',
            rawShares: sharesRaw,
            sshPrnamtType: optionalText(block, 'sshPrnamtType'),
            putCall: optionalText(block, 'putCall'),
            investmentDiscretion,
            votingAuthority: votingAuthority ? {
                Sole: optionalText(votingAuthority, 'Sole'),
                Shared: optionalText(votingAuthority, 'Shared'),
                None: optionalText(votingAuthority, 'None'),
            } : undefined,
        },
    };

    const validation = alphaRadarFilingHoldingSchema.safeParse(holding);
    if (!validation.success) {
        const issue = validation.error.issues[0];
        throw new ThirteenFParseError(
            issue?.message ?? 'Parsed 13F holding failed validation',
            context,
            { rowIndex, field: issue?.path.join('.') || undefined },
        );
    }

    return holding;
}

function rankHoldings(holdings: ParsedThirteenFHolding[]): ParsedThirteenFHolding[] {
    return [...holdings]
        .sort((a, b) => {
            const valueDelta = b.valueUsd - a.valueUsd;
            if (valueDelta !== 0) return valueDelta;
            const issuerDelta = a.issuerName.localeCompare(b.issuerName);
            if (issuerDelta !== 0) return issuerDelta;
            return a.cusip.localeCompare(b.cusip);
        })
        .map((holding, index) => ({
            ...holding,
            positionRank: index + 1,
        }));
}

function extractTagBlocks(xml: string, tagName: string): string[] {
    const pattern = new RegExp(
        `<(?:[A-Za-z0-9_.-]+:)?${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escapeRegExp(tagName)}>`,
        'gi',
    );
    const blocks: string[] = [];
    let match = pattern.exec(xml);
    while (match) {
        blocks.push(match[1]);
        match = pattern.exec(xml);
    }
    return blocks;
}

function extractFirstTagBlock(xml: string, tagName: string): string | undefined {
    return extractTagBlocks(xml, tagName)[0];
}

function requireText(xml: string, tagName: string, context: ParseThirteenFContext, rowIndex: number): string {
    const value = optionalText(xml, tagName);
    if (!value) {
        throw new ThirteenFParseError('Missing required 13F holding field', context, { rowIndex, field: tagName });
    }
    return value;
}

function optionalText(xml: string | undefined, tagName: string): string | undefined {
    if (!xml) return undefined;

    const block = extractFirstTagBlock(xml, tagName);
    if (block === undefined) return undefined;

    const cleaned = decodeXmlEntities(stripCdata(block)).replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
}

function stripCdata(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>')) {
        return trimmed.slice(9, -3);
    }
    return value;
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

function parseNonNegativeNumber(
    raw: string,
    field: string,
    context: ParseThirteenFContext,
    rowIndex: number,
): number {
    const normalized = raw.replace(/,/g, '').trim();
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) {
        throw new ThirteenFParseError('Invalid numeric 13F holding field', context, { rowIndex, field });
    }
    return value;
}

function parseOptionalNonNegativeNumber(
    xml: string | undefined,
    tagName: string,
    context: ParseThirteenFContext,
    rowIndex: number,
): number | undefined {
    const raw = optionalText(xml, tagName);
    return raw === undefined ? undefined : parseNonNegativeNumber(raw, tagName, context, rowIndex);
}

function normalizePutCall(
    raw: string | undefined,
    context: ParseThirteenFContext,
    rowIndex: number,
): 'put' | 'call' | undefined {
    if (!raw) return undefined;

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'put' || normalized === 'call') return normalized;

    throw new ThirteenFParseError('Invalid put/call value in 13F holding', context, { rowIndex, field: 'putCall' });
}

function resolveTicker(
    resolver: CusipTickerResolver | undefined,
    cusip: string,
    issuerName: string,
): string | undefined {
    if (!resolver) return undefined;

    const ticker = typeof resolver === 'function'
        ? resolver(cusip, issuerName)
        : resolver[cusip] ?? resolver[cusip.toUpperCase()];

    return ticker?.trim().toUpperCase() || undefined;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
