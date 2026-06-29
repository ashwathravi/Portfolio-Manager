import type {
    AlphaRadarEvidenceLink,
    AlphaRadarExternalOverlay,
    AlphaRadarSemanticContextSnippet,
    AlphaRadarThesisDraft,
} from './agent-contracts';
import type { AlphaRadarConvictionItem } from './conviction';
import type { AlphaRadarMemoChange } from './memo';

export interface GenerateAlphaRadarThesisDraftsInput {
    changes: readonly AlphaRadarMemoChange[];
    convictionItems: readonly AlphaRadarConvictionItem[];
    reportPeriod: string;
    sourceFilingIds: readonly string[];
    semanticContext?: readonly AlphaRadarSemanticContextSnippet[];
    externalOverlays?: readonly AlphaRadarExternalOverlay[];
    existingThesisTickers?: readonly string[];
    sourceReportId?: string;
    limit?: number;
}

export interface AlphaRadarGeneratedThesisDraft extends AlphaRadarThesisDraft {
    ticker?: string;
    issuerName: string;
    duplicateOfExistingThesis: boolean;
    reviewStatus: 'needs-review';
}

export function generateAlphaRadarThesisDrafts(
    input: GenerateAlphaRadarThesisDraftsInput,
): AlphaRadarGeneratedThesisDraft[] {
    const changesBySecurity = new Map(input.changes.map((change) => [securityKey(change.ticker ?? change.cusip), change]));
    const existingTickers = new Set((input.existingThesisTickers ?? []).map((ticker) => ticker.toUpperCase()));
    const drafts = input.convictionItems
        .filter((item) => item.convictionScore >= 55)
        .map((item) => {
            const change = changesBySecurity.get(securityKey(item.ticker ?? item.cusip));
            if (!change) return null;
            const duplicate = Boolean(item.ticker && existingTickers.has(item.ticker.toUpperCase()));
            return buildDraft({
                item,
                change,
                duplicate,
                reportPeriod: input.reportPeriod,
                sourceFilingIds: input.sourceFilingIds,
                semanticContext: input.semanticContext ?? [],
                externalOverlays: input.externalOverlays ?? [],
                sourceReportId: input.sourceReportId,
            });
        })
        .filter((draft): draft is AlphaRadarGeneratedThesisDraft => Boolean(draft));

    return drafts
        .sort((a, b) => {
            const duplicateDelta = Number(a.duplicateOfExistingThesis) - Number(b.duplicateOfExistingThesis);
            if (duplicateDelta !== 0) return duplicateDelta;
            return a.title.localeCompare(b.title);
        })
        .slice(0, input.limit ?? 3);
}

function buildDraft(input: {
    item: AlphaRadarConvictionItem;
    change: AlphaRadarMemoChange;
    duplicate: boolean;
    reportPeriod: string;
    sourceFilingIds: readonly string[];
    semanticContext: readonly AlphaRadarSemanticContextSnippet[];
    externalOverlays: readonly AlphaRadarExternalOverlay[];
    sourceReportId?: string;
}): AlphaRadarGeneratedThesisDraft {
    const { item, change } = input;
    const label = item.ticker ? `${item.issuerName} (${item.ticker})` : item.issuerName;
    const evidence = buildEvidenceLinks(input);
    const overlaySummaries = input.externalOverlays
        .filter((overlay) => overlayMatchesItem(overlay, item))
        .map((overlay) => overlay.summary);
    const topFactors = item.factors.slice(0, 3).map((factor) => factor.label.toLowerCase());
    const duplicatePrefix = input.duplicate ? 'Existing thesis review' : 'Alpha Radar draft';

    return {
        id: `alpha-radar-draft:${item.id.toLowerCase()}`,
        ticker: item.ticker,
        issuerName: item.issuerName,
        title: `${duplicatePrefix}: ${label}`,
        hypothesis: [
            `${label} deserves human review because Alpha Radar ranked it ${item.convictionScore}/100.`,
            topFactors.length > 0 ? `Primary factors: ${topFactors.join(', ')}.` : 'Primary factors are still forming.',
            input.duplicate ? 'This matches an existing thesis ticker and should be treated as an update candidate, not a replacement.' : 'This is a candidate thesis and not an active recommendation.',
        ].join(' '),
        whyNow: [
            change.displayReason,
            `The ${input.reportPeriod} signal combines raw 13F movement, user relevance, and cited enrichment.`,
            overlaySummaries.length > 0 ? `Overlay context: ${overlaySummaries.slice(0, 2).join(' ')}` : 'No external overlay changed the source 13F fact pattern.',
        ].join(' '),
        falsifyIf: [
            `The next 13F reverses the ${change.changeType} signal,`,
            'the linked evidence no longer supports the setup,',
            'or portfolio/watchlist overlap disappears before review.',
        ].join(' '),
        supportingEvidence: evidence,
        risks: [
            '13F filings are delayed and exclude shorts, derivatives below reporting thresholds, and intra-quarter trades.',
            'External overlays are enrichment, not source 13F facts.',
            input.duplicate ? 'Existing thesis conflict: review before changing active thesis state.' : 'Interpretation risk: promote only after human review.',
        ],
        nextWatchItems: [
            `Re-check ${label} after the next 13F filing.`,
            'Ask Ledger follow-up: summarize evidence for and against this draft.',
            input.duplicate ? 'Compare this draft against the existing active thesis before editing.' : 'Decide whether to promote, edit, or archive this candidate.',
        ],
        confidence: item.convictionScore >= 80 ? 'high' : item.convictionScore >= 65 ? 'medium' : 'low',
        sourceReportId: input.sourceReportId,
        duplicateOfExistingThesis: input.duplicate,
        reviewStatus: 'needs-review',
    };
}

function buildEvidenceLinks(input: {
    item: AlphaRadarConvictionItem;
    change: AlphaRadarMemoChange;
    sourceFilingIds: readonly string[];
    semanticContext: readonly AlphaRadarSemanticContextSnippet[];
    externalOverlays: readonly AlphaRadarExternalOverlay[];
}): AlphaRadarEvidenceLink[] {
    const links: AlphaRadarEvidenceLink[] = [{
        kind: 'holding-change',
        id: input.change.id ?? `${input.change.trackedFilerId}:${input.change.reportPeriod}:${input.change.cusip}`,
        title: `${input.change.issuerName} ${input.change.changeType} in ${input.change.reportPeriod}`,
        citation: input.change.displayReason,
    }];

    for (const filingId of input.sourceFilingIds) {
        links.push({
            kind: 'filing',
            id: filingId,
            title: `Source 13F filing ${filingId}`,
            citation: `Source filing for ${input.change.reportPeriod}.`,
        });
    }

    for (const overlay of input.externalOverlays.filter((item) => overlayMatchesItem(item, input.item))) {
        links.push(...overlay.evidence);
    }

    for (const snippet of input.semanticContext.filter((item) => snippetMatchesItem(item, input.item))) {
        links.push(snippet.citation);
    }

    return dedupeEvidence(links);
}

function overlayMatchesItem(overlay: AlphaRadarExternalOverlay, item: AlphaRadarConvictionItem): boolean {
    const overlayTicker = overlay.ticker?.toUpperCase();
    const itemTicker = item.ticker?.toUpperCase();
    if (overlayTicker && itemTicker && overlayTicker === itemTicker) return true;
    return normalizeIssuer(overlay.issuerName) === normalizeIssuer(item.issuerName);
}

function snippetMatchesItem(snippet: AlphaRadarSemanticContextSnippet, item: AlphaRadarConvictionItem): boolean {
    const haystack = `${snippet.text} ${snippet.citation.title} ${snippet.citation.citation ?? ''}`.toLowerCase();
    return Boolean(
        (item.ticker && haystack.includes(item.ticker.toLowerCase()))
        || haystack.includes(item.issuerName.toLowerCase())
        || haystack.includes(item.cusip.toLowerCase()),
    );
}

function dedupeEvidence(links: readonly AlphaRadarEvidenceLink[]): AlphaRadarEvidenceLink[] {
    const seen = new Set<string>();
    const deduped: AlphaRadarEvidenceLink[] = [];
    for (const link of links) {
        const key = `${link.kind}:${link.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(link);
    }
    return deduped;
}

function securityKey(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeIssuer(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(inc|corp|corporation|co|company|ltd|limited|plc|class|cl|common|stock)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
