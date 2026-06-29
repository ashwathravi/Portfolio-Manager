import {
    alphaRadarHoldingChangeSchema,
    type AlphaRadarUserRelevanceInput as AlphaRadarUserRelevance,
} from '@/lib/validators/alpha-radar';

export type AlphaRadarDiffChangeType = 'new' | 'exited' | 'increased' | 'decreased' | 'unchanged' | 'amended';

export interface AlphaRadarDiffHolding {
    issuerName: string;
    cusip: string;
    ticker?: string;
    valueUsd: number;
    shares: number;
    positionRank?: number;
}

export interface AlphaRadarUserOverlapInput {
    portfolioTickers?: readonly string[];
    portfolioCusips?: readonly string[];
    watchlistTickers?: readonly string[];
    thesisTickers?: readonly string[];
}

export interface ComputeQuarterlyChangesInput {
    trackedFilerId: string;
    currentFilingId?: string;
    priorFilingId?: string;
    reportPeriod: string;
    currentHoldings: readonly AlphaRadarDiffHolding[];
    priorHoldings: readonly AlphaRadarDiffHolding[];
    amendedCusips?: Iterable<string>;
    userRelevance?: AlphaRadarUserOverlapInput;
}

export interface AlphaRadarHoldingChange {
    trackedFilerId: string;
    currentFilingId?: string;
    priorFilingId?: string;
    reportPeriod: string;
    changeType: AlphaRadarDiffChangeType;
    issuerName: string;
    cusip: string;
    ticker?: string;
    currentValueUsd?: number;
    priorValueUsd?: number;
    valueDeltaUsd?: number;
    currentShares?: number;
    priorShares?: number;
    shareDelta?: number;
    currentWeight?: number;
    priorWeight?: number;
    weightDelta?: number;
    rankDelta?: number;
    materialityScore: number;
    userRelevance: AlphaRadarUserRelevance;
    displayReason: string;
    firstSeenReportPeriod?: string;
    lastSeenReportPeriod?: string;
}

interface NormalizedHolding extends AlphaRadarDiffHolding {
    cusip: string;
    ticker?: string;
    positionRank: number;
}

const EMPTY_RELEVANCE: AlphaRadarUserRelevance = {
    portfolio: false,
    watchlist: false,
    thesis: false,
    reasons: [],
    matchedTickers: [],
    matchedCusips: [],
};

export function computeQuarterlyHoldingChanges(input: ComputeQuarterlyChangesInput): AlphaRadarHoldingChange[] {
    const current = normalizeHoldings(input.currentHoldings);
    const prior = normalizeHoldings(input.priorHoldings);
    const currentByCusip = mapByCusip(current);
    const priorByCusip = mapByCusip(prior);
    const currentTotal = sumValue(current);
    const priorTotal = sumValue(prior);
    const amendedCusips = new Set([...input.amendedCusips ?? []].map((cusip) => cusip.trim().toUpperCase()));
    const cusips = new Set([...currentByCusip.keys(), ...priorByCusip.keys()]);

    const changes = [...cusips].map((cusip) => {
        const currentHolding = currentByCusip.get(cusip);
        const priorHolding = priorByCusip.get(cusip);
        return buildChange({
            input,
            cusip,
            currentHolding,
            priorHolding,
            currentTotal,
            priorTotal,
            amended: amendedCusips.has(cusip),
        });
    });

    return changes.sort(compareChanges);
}

function buildChange(args: {
    input: ComputeQuarterlyChangesInput;
    cusip: string;
    currentHolding: NormalizedHolding | undefined;
    priorHolding: NormalizedHolding | undefined;
    currentTotal: number;
    priorTotal: number;
    amended: boolean;
}): AlphaRadarHoldingChange {
    const { input, currentHolding, priorHolding } = args;
    const issuerName = currentHolding?.issuerName ?? priorHolding?.issuerName ?? args.cusip;
    const ticker = currentHolding?.ticker ?? priorHolding?.ticker;
    const currentValueUsd = currentHolding?.valueUsd;
    const priorValueUsd = priorHolding?.valueUsd;
    const currentShares = currentHolding?.shares;
    const priorShares = priorHolding?.shares;
    const valueDeltaUsd = delta(currentValueUsd, priorValueUsd);
    const shareDelta = delta(currentShares, priorShares);
    const currentWeight = currentValueUsd === undefined ? undefined : safeFraction(currentValueUsd, args.currentTotal);
    const priorWeight = priorValueUsd === undefined ? undefined : safeFraction(priorValueUsd, args.priorTotal);
    const weightDelta = delta(currentWeight, priorWeight);
    const rankDelta = currentHolding && priorHolding ? priorHolding.positionRank - currentHolding.positionRank : undefined;
    const changeType = classifyChange({
        currentHolding,
        priorHolding,
        valueDeltaUsd,
        shareDelta,
        amended: args.amended,
    });
    const userRelevance = resolveUserRelevance(input.userRelevance, ticker, args.cusip);
    const materialityScore = scoreMateriality({
        changeType,
        currentWeight,
        priorWeight,
        weightDelta,
        currentHolding,
        priorHolding,
        shareDelta,
        priorShares,
        userRelevance,
    });
    const displayReason = describeChange({
        changeType,
        issuerName,
        ticker,
        currentValueUsd,
        priorValueUsd,
        valueDeltaUsd,
        currentWeight,
        priorWeight,
        rankDelta,
        userRelevance,
    });

    const change: AlphaRadarHoldingChange = {
        trackedFilerId: input.trackedFilerId,
        currentFilingId: currentHolding ? input.currentFilingId : undefined,
        priorFilingId: priorHolding ? input.priorFilingId : undefined,
        reportPeriod: input.reportPeriod,
        changeType,
        issuerName,
        cusip: args.cusip,
        ticker,
        currentValueUsd,
        priorValueUsd,
        valueDeltaUsd,
        currentShares,
        priorShares,
        shareDelta,
        currentWeight,
        priorWeight,
        weightDelta,
        rankDelta,
        materialityScore,
        userRelevance,
        displayReason,
        firstSeenReportPeriod: currentHolding && !priorHolding ? input.reportPeriod : undefined,
        lastSeenReportPeriod: priorHolding && !currentHolding ? input.reportPeriod : undefined,
    };

    const validation = alphaRadarHoldingChangeSchema.safeParse(change);
    if (!validation.success) {
        const issue = validation.error.issues[0];
        throw new Error(`Alpha Radar holding change failed validation for ${args.cusip}: ${issue?.message ?? 'unknown error'}`);
    }

    return change;
}

function normalizeHoldings(holdings: readonly AlphaRadarDiffHolding[]): NormalizedHolding[] {
    return [...holdings]
        .map((holding, sourceIndex) => ({
            ...holding,
            cusip: holding.cusip.trim().toUpperCase(),
            ticker: holding.ticker?.trim().toUpperCase() || undefined,
            positionRank: holding.positionRank ?? sourceIndex + 1,
        }))
        .sort((a, b) => {
            const explicitRankDelta = a.positionRank - b.positionRank;
            if (explicitRankDelta !== 0) return explicitRankDelta;
            const valueDelta = b.valueUsd - a.valueUsd;
            if (valueDelta !== 0) return valueDelta;
            return a.cusip.localeCompare(b.cusip);
        })
        .map((holding, index) => ({
            ...holding,
            positionRank: holding.positionRank || index + 1,
        }));
}

function mapByCusip(holdings: readonly NormalizedHolding[]): Map<string, NormalizedHolding> {
    return new Map(holdings.map((holding) => [holding.cusip, holding]));
}

function sumValue(holdings: readonly AlphaRadarDiffHolding[]): number {
    return holdings.reduce((sum, holding) => sum + holding.valueUsd, 0);
}

function safeFraction(numerator: number, denominator: number): number {
    if (!Number.isFinite(denominator) || denominator <= 0) return 0;
    return round(numerator / denominator, 6);
}

function delta(current: number | undefined, prior: number | undefined): number | undefined {
    if (current === undefined && prior === undefined) return undefined;
    return round((current ?? 0) - (prior ?? 0), 6);
}

function classifyChange(input: {
    currentHolding: NormalizedHolding | undefined;
    priorHolding: NormalizedHolding | undefined;
    valueDeltaUsd: number | undefined;
    shareDelta: number | undefined;
    amended: boolean;
}): AlphaRadarDiffChangeType {
    if (input.currentHolding && !input.priorHolding) return 'new';
    if (!input.currentHolding && input.priorHolding) return 'exited';
    if (input.amended) return 'amended';

    const valueDelta = input.valueDeltaUsd ?? 0;
    const shareDelta = input.shareDelta ?? 0;
    if (valueDelta > 0 || shareDelta > 0) return 'increased';
    if (valueDelta < 0 || shareDelta < 0) return 'decreased';
    return 'unchanged';
}

function resolveUserRelevance(
    input: AlphaRadarUserOverlapInput | undefined,
    ticker: string | undefined,
    cusip: string,
): AlphaRadarUserRelevance {
    if (!input) return { ...EMPTY_RELEVANCE, reasons: [], matchedTickers: [], matchedCusips: [] };

    const normalizedTicker = ticker?.toUpperCase();
    const portfolioTickers = new Set((input.portfolioTickers ?? []).map((value) => value.toUpperCase()));
    const watchlistTickers = new Set((input.watchlistTickers ?? []).map((value) => value.toUpperCase()));
    const thesisTickers = new Set((input.thesisTickers ?? []).map((value) => value.toUpperCase()));
    const portfolioCusips = new Set((input.portfolioCusips ?? []).map((value) => value.toUpperCase()));
    const portfolio = Boolean((normalizedTicker && portfolioTickers.has(normalizedTicker)) || portfolioCusips.has(cusip));
    const watchlist = Boolean(normalizedTicker && watchlistTickers.has(normalizedTicker));
    const thesis = Boolean(normalizedTicker && thesisTickers.has(normalizedTicker));
    const reasons = [
        portfolio ? 'Held in portfolio' : null,
        watchlist ? 'On watchlist' : null,
        thesis ? 'Linked to active thesis' : null,
    ].filter((reason): reason is string => Boolean(reason));

    return {
        portfolio,
        watchlist,
        thesis,
        reasons,
        matchedTickers: normalizedTicker && (portfolio || watchlist || thesis) ? [normalizedTicker] : [],
        matchedCusips: portfolioCusips.has(cusip) ? [cusip] : [],
    };
}

function scoreMateriality(input: {
    changeType: AlphaRadarDiffChangeType;
    currentWeight: number | undefined;
    priorWeight: number | undefined;
    weightDelta: number | undefined;
    currentHolding: NormalizedHolding | undefined;
    priorHolding: NormalizedHolding | undefined;
    shareDelta: number | undefined;
    priorShares: number | undefined;
    userRelevance: AlphaRadarUserRelevance;
}): number {
    const largestWeight = Math.max(input.currentWeight ?? 0, input.priorWeight ?? 0);
    const absWeightDelta = Math.abs(input.weightDelta ?? 0);
    const shareChangeRatio = input.priorShares && input.priorShares > 0
        ? Math.min(Math.abs(input.shareDelta ?? 0) / input.priorShares, 1)
        : input.changeType === 'new' || input.changeType === 'exited'
            ? 1
            : 0;
    const bestRank = Math.min(input.currentHolding?.positionRank ?? Infinity, input.priorHolding?.positionRank ?? Infinity);
    const relevanceBoost = [
        input.userRelevance.portfolio ? 12 : 0,
        input.userRelevance.watchlist ? 7 : 0,
        input.userRelevance.thesis ? 7 : 0,
    ].reduce((sum, value) => sum + value, 0);

    let score = 0;
    score += Math.min(35, absWeightDelta * 350);
    score += Math.min(25, largestWeight * 100);
    score += Math.min(20, shareChangeRatio * 20);
    score += input.changeType === 'new' || input.changeType === 'exited' ? 12 : 0;
    score += bestRank <= 10 ? 8 : 0;
    score += input.changeType === 'amended' ? 5 : 0;
    score += relevanceBoost;

    return Math.min(100, Math.round(score));
}

function describeChange(input: {
    changeType: AlphaRadarDiffChangeType;
    issuerName: string;
    ticker: string | undefined;
    currentValueUsd: number | undefined;
    priorValueUsd: number | undefined;
    valueDeltaUsd: number | undefined;
    currentWeight: number | undefined;
    priorWeight: number | undefined;
    rankDelta: number | undefined;
    userRelevance: AlphaRadarUserRelevance;
}): string {
    const label = input.ticker ? `${input.issuerName} (${input.ticker})` : input.issuerName;
    const relevance = input.userRelevance.reasons.length > 0
        ? ` ${input.userRelevance.reasons.join(', ').toLowerCase()}.`
        : '';

    switch (input.changeType) {
        case 'new':
            return `New position in ${label} at ${formatUsd(input.currentValueUsd)} (${formatPct(input.currentWeight)} of reported 13F).${relevance}`;
        case 'exited':
            return `Exited ${label}, removing ${formatUsd(input.priorValueUsd)} from the prior 13F.${relevance}`;
        case 'increased':
            return `Increased ${label} by ${formatUsd(input.valueDeltaUsd)} to ${formatUsd(input.currentValueUsd)} (${formatPct(input.currentWeight)} of 13F).${formatRank(input.rankDelta)}${relevance}`;
        case 'decreased':
            return `Trimmed ${label} by ${formatUsd(Math.abs(input.valueDeltaUsd ?? 0))} to ${formatUsd(input.currentValueUsd)} (${formatPct(input.currentWeight)} of 13F).${formatRank(input.rankDelta)}${relevance}`;
        case 'amended':
            return `Amended ${label}; current value is ${formatUsd(input.currentValueUsd)} versus ${formatUsd(input.priorValueUsd)} previously.${formatRank(input.rankDelta)}${relevance}`;
        case 'unchanged':
            return `${label} was unchanged at ${formatUsd(input.currentValueUsd)} (${formatPct(input.currentWeight)} of 13F).${relevance}`;
    }
}

function compareChanges(a: AlphaRadarHoldingChange, b: AlphaRadarHoldingChange): number {
    const scoreDelta = b.materialityScore - a.materialityScore;
    if (scoreDelta !== 0) return scoreDelta;

    const valueDelta = Math.abs(b.valueDeltaUsd ?? 0) - Math.abs(a.valueDeltaUsd ?? 0);
    if (valueDelta !== 0) return valueDelta;

    const issuerDelta = a.issuerName.localeCompare(b.issuerName);
    if (issuerDelta !== 0) return issuerDelta;
    return a.cusip.localeCompare(b.cusip);
}

function formatRank(rankDelta: number | undefined): string {
    if (!rankDelta) return '';
    return rankDelta > 0 ? ` Rank improved by ${rankDelta}.` : ` Rank fell by ${Math.abs(rankDelta)}.`;
}

function formatUsd(value: number | undefined): string {
    const amount = value ?? 0;
    if (Math.abs(amount) >= 1_000_000_000) return `$${round(amount / 1_000_000_000, 1)}B`;
    if (Math.abs(amount) >= 1_000_000) return `$${round(amount / 1_000_000, 1)}M`;
    if (Math.abs(amount) >= 1_000) return `$${round(amount / 1_000, 1)}K`;
    return `$${round(amount, 2)}`;
}

function formatPct(value: number | undefined): string {
    return `${round((value ?? 0) * 100, 1)}%`;
}

function round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
