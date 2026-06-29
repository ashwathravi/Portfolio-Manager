import type { AlphaRadarMemoChange } from './memo';
import type { AlphaRadarCloneCluster } from './clone-graph';
import type { AlphaRadarSemanticContextSnippet } from './agent-contracts';

export type AlphaRadarConvictionFactorKind =
    | 'materiality'
    | 'position-size'
    | 'weight-change'
    | 'rank-change'
    | 'change-type'
    | 'filer-consensus'
    | 'persistence'
    | 'portfolio-overlap'
    | 'watchlist-overlap'
    | 'thesis-overlap'
    | 'evidence-fit';

export type AlphaRadarConvictionComponent = 'raw-13f-signal' | 'user-relevance' | 'evidence-fit';

export type AlphaRadarConvictionDirection = 'positive' | 'negative' | 'neutral';

export type AlphaRadarConvictionTrend = 'strengthening' | 'weakening' | 'stable' | 'new';

export interface AlphaRadarConvictionFactor {
    kind: AlphaRadarConvictionFactorKind;
    component: AlphaRadarConvictionComponent;
    label: string;
    score: number;
    maxScore: number;
    direction: AlphaRadarConvictionDirection;
    detail: string;
}

export interface AlphaRadarConvictionHistoryPoint {
    securityKey: string;
    reportPeriod: string;
    convictionScore: number;
    rawSignalScore?: number;
    userRelevanceScore?: number;
    evidenceFitScore?: number;
}

export interface AlphaRadarConvictionItem {
    id: string;
    securityKey: string;
    trackedFilerId: string;
    reportPeriod: string;
    ticker?: string;
    cusip: string;
    issuerName: string;
    changeType: AlphaRadarMemoChange['changeType'];
    convictionScore: number;
    rawSignalScore: number;
    userRelevanceScore: number;
    evidenceFitScore: number;
    rank: number;
    trend: AlphaRadarConvictionTrend;
    priorScore?: number;
    factors: AlphaRadarConvictionFactor[];
    displayReason: string;
}

export interface ScoreAlphaRadarConvictionInput {
    changes: readonly AlphaRadarMemoChange[];
    cloneClusters?: readonly AlphaRadarCloneCluster[];
    semanticContext?: readonly AlphaRadarSemanticContextSnippet[];
    history?: readonly AlphaRadarConvictionHistoryPoint[];
    reportPeriod?: string;
}

const RAW_MAX = 85;
const USER_MAX = 24;
const EVIDENCE_MAX = 8;

export function scoreAlphaRadarConviction(input: ScoreAlphaRadarConvictionInput): AlphaRadarConvictionItem[] {
    const clustersBySecurity = new Map((input.cloneClusters ?? []).map((cluster) => [normalizeKey(cluster.securityKey), cluster]));
    const historyBySecurity = latestHistoryBySecurity(input.history ?? [], input.reportPeriod);
    const changes = input.reportPeriod
        ? input.changes.filter((change) => change.reportPeriod === input.reportPeriod)
        : [...input.changes];

    return changes
        .filter((change) => change.changeType !== 'unchanged')
        .map((change) => {
            const securityKey = normalizeKey(change.ticker ?? change.cusip);
            const cluster = clustersBySecurity.get(securityKey);
            const history = historyBySecurity.get(securityKey);
            const factors = buildFactors(change, cluster, input.semanticContext ?? [], history);
            const rawPoints = sumFactors(factors, 'raw-13f-signal');
            const userPoints = sumFactors(factors, 'user-relevance');
            const evidencePoints = sumFactors(factors, 'evidence-fit');
            const rawSignalScore = normalizeScore(rawPoints, RAW_MAX);
            const userRelevanceScore = normalizeScore(userPoints, USER_MAX);
            const evidenceFitScore = normalizeScore(evidencePoints, EVIDENCE_MAX);
            const convictionScore = Math.min(100, Math.round(rawPoints + userPoints + evidencePoints));
            const priorScore = history?.convictionScore;

            return {
                id: `${change.trackedFilerId}:${change.reportPeriod}:${securityKey}`,
                securityKey,
                trackedFilerId: change.trackedFilerId,
                reportPeriod: change.reportPeriod,
                ticker: change.ticker,
                cusip: change.cusip,
                issuerName: change.issuerName,
                changeType: change.changeType,
                convictionScore,
                rawSignalScore,
                userRelevanceScore,
                evidenceFitScore,
                rank: 0,
                trend: resolveTrend(convictionScore, priorScore),
                priorScore,
                factors: factors
                    .filter((factor) => factor.score > 0)
                    .sort(compareFactors),
                displayReason: change.displayReason,
            };
        })
        .sort(compareConvictionItems)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function summarizeAlphaRadarConviction(item: AlphaRadarConvictionItem): string {
    const primaryFactors = item.factors.slice(0, 3).map((factor) => factor.label.toLowerCase());
    const label = item.ticker ? `${item.issuerName} (${item.ticker})` : item.issuerName;
    if (primaryFactors.length === 0) {
        return `${label} ranked ${item.convictionScore}/100 with no dominant contributing factor.`;
    }
    return `${label} ranked ${item.convictionScore}/100 due to ${primaryFactors.join(', ')}.`;
}

function buildFactors(
    change: AlphaRadarMemoChange,
    cluster: AlphaRadarCloneCluster | undefined,
    semanticContext: readonly AlphaRadarSemanticContextSnippet[],
    history: AlphaRadarConvictionHistoryPoint | undefined,
): AlphaRadarConvictionFactor[] {
    const largestWeight = Math.max(change.currentWeight ?? 0, change.priorWeight ?? 0);
    const absWeightDelta = Math.abs(change.weightDelta ?? 0);
    const rankDelta = Math.abs(change.rankDelta ?? 0);
    const evidenceScore = scoreEvidenceFit(change, semanticContext);
    const persistenceScore = scorePersistence(history);
    const clusterConsensus = scoreClusterConsensus(cluster);
    const clusterUserBonus = cluster ? scoreClusterUserOverlap(change, cluster) : [];

    return [
        factor(
            'materiality',
            'raw-13f-signal',
            'Material 13F change',
            Math.min(25, change.materialityScore * 0.25),
            25,
            'positive',
            `Materiality ${change.materialityScore}/100 from the v1 delta engine.`,
        ),
        factor(
            'position-size',
            'raw-13f-signal',
            'Large reported position',
            Math.min(12, largestWeight * 120),
            12,
            'positive',
            `Largest reported weight is ${formatPct(largestWeight)}.`,
        ),
        factor(
            'weight-change',
            'raw-13f-signal',
            'Meaningful weight movement',
            Math.min(12, absWeightDelta * 500),
            12,
            'positive',
            `Reported 13F weight moved by ${formatPct(absWeightDelta)}.`,
        ),
        factor(
            'rank-change',
            'raw-13f-signal',
            'Rank movement',
            Math.min(8, rankDelta * 3),
            8,
            change.rankDelta && change.rankDelta < 0 ? 'negative' : 'positive',
            change.rankDelta
                ? `Position rank ${change.rankDelta > 0 ? 'improved' : 'fell'} by ${rankDelta}.`
                : 'No rank movement was detected.',
        ),
        factor(
            'change-type',
            'raw-13f-signal',
            'Actionable change type',
            scoreChangeType(change.changeType),
            8,
            change.changeType === 'exited' || change.changeType === 'decreased' ? 'negative' : 'positive',
            `${change.changeType} changes receive explicit signal weight.`,
        ),
        factor(
            'filer-consensus',
            'raw-13f-signal',
            'Cross-filer consensus',
            clusterConsensus,
            12,
            cluster?.direction === 'consensus_sell' ? 'negative' : 'positive',
            cluster
                ? `${cluster.filers.length} tracked filer${cluster.filers.length === 1 ? '' : 's'} changed this security; direction is ${cluster.direction.replace(/_/g, ' ')}.`
                : 'No cross-filer cluster is available.',
        ),
        factor(
            'persistence',
            'raw-13f-signal',
            'Persistent conviction',
            persistenceScore,
            8,
            history && history.convictionScore < 50 ? 'neutral' : 'positive',
            history
                ? `Prior conviction score was ${history.convictionScore}/100 in ${history.reportPeriod}.`
                : 'No prior conviction score is available.',
        ),
        factor(
            'portfolio-overlap',
            'user-relevance',
            'Portfolio overlap',
            change.userRelevance.portfolio ? 8 : clusterUserBonus.includes('portfolio') ? 4 : 0,
            8,
            'positive',
            'Security overlaps with current holdings or a portfolio-level clone cluster.',
        ),
        factor(
            'watchlist-overlap',
            'user-relevance',
            'Watchlist overlap',
            change.userRelevance.watchlist ? 5 : clusterUserBonus.includes('watchlist') ? 3 : 0,
            5,
            'positive',
            'Security overlaps with watchlist context.',
        ),
        factor(
            'thesis-overlap',
            'user-relevance',
            'Active thesis overlap',
            change.userRelevance.thesis ? 7 : clusterUserBonus.includes('thesis') ? 4 : 0,
            7,
            'positive',
            'Security overlaps with an active thesis or thesis-linked clone cluster.',
        ),
        factor(
            'evidence-fit',
            'evidence-fit',
            'Evidence fit',
            evidenceScore,
            8,
            'positive',
            evidenceScore > 0
                ? 'Semantic filing memory contains matching evidence for this issuer or ticker.'
                : 'No matching semantic evidence was attached to this scoring run.',
        ),
    ];
}

function factor(
    kind: AlphaRadarConvictionFactorKind,
    component: AlphaRadarConvictionComponent,
    label: string,
    score: number,
    maxScore: number,
    direction: AlphaRadarConvictionDirection,
    detail: string,
): AlphaRadarConvictionFactor {
    return {
        kind,
        component,
        label,
        score: round(Math.max(0, Math.min(maxScore, score))),
        maxScore,
        direction,
        detail,
    };
}

function scoreChangeType(changeType: AlphaRadarMemoChange['changeType']): number {
    switch (changeType) {
        case 'new':
        case 'exited':
            return 8;
        case 'increased':
        case 'decreased':
            return 5;
        case 'amended':
            return 3;
        case 'unchanged':
            return 0;
    }
}

function scoreClusterConsensus(cluster: AlphaRadarCloneCluster | undefined): number {
    if (!cluster || cluster.filers.length <= 1) return 0;
    const multiFilerScore = Math.min(6, (cluster.filers.length - 1) * 3);
    const directionScore = cluster.direction === 'consensus_buy' || cluster.direction === 'consensus_sell' ? 4 : 2;
    const overlapScore = Math.min(2, cluster.overlapScore / 50);
    return multiFilerScore + directionScore + overlapScore;
}

function scoreClusterUserOverlap(
    change: AlphaRadarMemoChange,
    cluster: AlphaRadarCloneCluster,
): Array<'portfolio' | 'watchlist' | 'thesis'> {
    return [
        !change.userRelevance.portfolio && cluster.userOverlap.portfolio ? 'portfolio' : null,
        !change.userRelevance.watchlist && cluster.userOverlap.watchlist ? 'watchlist' : null,
        !change.userRelevance.thesis && cluster.userOverlap.thesis ? 'thesis' : null,
    ].filter((item): item is 'portfolio' | 'watchlist' | 'thesis' => Boolean(item));
}

function scoreEvidenceFit(
    change: AlphaRadarMemoChange,
    semanticContext: readonly AlphaRadarSemanticContextSnippet[],
): number {
    const ticker = change.ticker?.toLowerCase();
    const issuer = change.issuerName.toLowerCase();
    const cusip = change.cusip.toLowerCase();
    const matches = semanticContext.filter((snippet) => {
        const haystack = [
            snippet.text,
            snippet.citation.title,
            snippet.citation.citation,
            snippet.sourceId,
        ].join(' ').toLowerCase();
        return Boolean(
            (ticker && haystack.includes(ticker))
            || haystack.includes(issuer)
            || haystack.includes(cusip),
        );
    });

    if (matches.length === 0) return 0;
    const strongest = Math.max(...matches.map((match) => match.score));
    return Math.min(8, 3 + Math.min(3, matches.length) + strongest);
}

function scorePersistence(history: AlphaRadarConvictionHistoryPoint | undefined): number {
    if (!history) return 0;
    if (history.convictionScore >= 80) return 8;
    if (history.convictionScore >= 65) return 6;
    if (history.convictionScore >= 50) return 4;
    return 2;
}

function latestHistoryBySecurity(
    history: readonly AlphaRadarConvictionHistoryPoint[],
    currentReportPeriod: string | undefined,
): Map<string, AlphaRadarConvictionHistoryPoint> {
    const map = new Map<string, AlphaRadarConvictionHistoryPoint>();
    for (const point of history) {
        if (currentReportPeriod && point.reportPeriod >= currentReportPeriod) continue;
        const key = normalizeKey(point.securityKey);
        const existing = map.get(key);
        if (!existing || existing.reportPeriod < point.reportPeriod) {
            map.set(key, { ...point, securityKey: key });
        }
    }
    return map;
}

function resolveTrend(score: number, priorScore: number | undefined): AlphaRadarConvictionTrend {
    if (priorScore === undefined) return 'new';
    const delta = score - priorScore;
    if (delta >= 5) return 'strengthening';
    if (delta <= -5) return 'weakening';
    return 'stable';
}

function sumFactors(
    factors: readonly AlphaRadarConvictionFactor[],
    component: AlphaRadarConvictionComponent,
): number {
    return factors
        .filter((factor) => factor.component === component)
        .reduce((sum, factor) => sum + factor.score, 0);
}

function normalizeScore(score: number, maxScore: number): number {
    if (maxScore <= 0) return 0;
    return Math.min(100, Math.round((score / maxScore) * 100));
}

function compareConvictionItems(a: AlphaRadarConvictionItem, b: AlphaRadarConvictionItem): number {
    const scoreDelta = b.convictionScore - a.convictionScore;
    if (scoreDelta !== 0) return scoreDelta;
    const rawDelta = b.rawSignalScore - a.rawSignalScore;
    if (rawDelta !== 0) return rawDelta;
    const issuerDelta = a.issuerName.localeCompare(b.issuerName);
    if (issuerDelta !== 0) return issuerDelta;
    return a.cusip.localeCompare(b.cusip);
}

function compareFactors(a: AlphaRadarConvictionFactor, b: AlphaRadarConvictionFactor): number {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return a.kind.localeCompare(b.kind);
}

function normalizeKey(value: string): string {
    return value.trim().toUpperCase();
}

function formatPct(value: number): string {
    return `${round(value * 100, 1)}%`;
}

function round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
