import { maxDrawdown, simpleReturn } from '@/lib/performance/calculations';
import type { AlphaRadarCloneCluster } from './clone-graph';
import type { AlphaRadarConvictionItem } from './conviction';
import type { AlphaRadarMemoChange } from './memo';

export type AlphaRadarBacktestScenario =
    | 'top-adds'
    | 'exits'
    | 'consensus'
    | 'conviction'
    | 'user-overlap';

export type AlphaRadarBacktestDirection = 'long' | 'avoid-or-short';

export interface AlphaRadarBacktestPricePoint {
    date: string;
    close: number;
    splitAdjusted?: boolean;
}

export interface AlphaRadarBacktestSignal {
    id: string;
    scenario: AlphaRadarBacktestScenario;
    direction: AlphaRadarBacktestDirection;
    trackedFilerId?: string;
    reportPeriod: string;
    reportPeriodEnd?: string;
    filingAcceptedAt?: string;
    ticker?: string;
    issuerName: string;
    changeType?: AlphaRadarMemoChange['changeType'];
    materialityScore: number;
    convictionScore?: number;
    consensusScore?: number;
    userOverlap: boolean;
    source: 'holding-change' | 'clone-cluster' | 'conviction';
}

export interface AlphaRadarBacktestTradeResult {
    signalId: string;
    scenario: AlphaRadarBacktestScenario;
    ticker: string;
    issuerName: string;
    reportPeriod: string;
    direction: AlphaRadarBacktestDirection;
    windowDays: number;
    availabilityDate: string;
    entryDate: string;
    exitDate: string;
    entryPrice: number;
    exitPrice: number;
    securityReturn: number;
    signalReturn: number;
    benchmarkReturn: number;
    relativeReturn: number;
    maxDrawdown: number;
    lagDays: number;
    hit: boolean;
    warnings: string[];
}

export interface AlphaRadarBacktestSkippedSignal {
    signalId: string;
    scenario: AlphaRadarBacktestScenario;
    ticker?: string;
    issuerName: string;
    windowDays: number;
    reason: string;
}

export interface AlphaRadarBacktestScenarioSummary {
    scenario: AlphaRadarBacktestScenario;
    windowDays: number;
    completed: number;
    skipped: number;
    hitRate: number;
    averageSignalReturn: number;
    averageBenchmarkReturn: number;
    averageRelativeReturn: number;
    worstDrawdown: number;
    averageLagDays: number;
}

export interface AlphaRadarBacktestResult {
    generatedAt: string;
    availabilityLagDays: number;
    benchmarkTicker: string;
    trades: AlphaRadarBacktestTradeResult[];
    skipped: AlphaRadarBacktestSkippedSignal[];
    summaries: AlphaRadarBacktestScenarioSummary[];
    methodologyNote: string;
}

export interface BuildAlphaRadarBacktestSignalsInput {
    changes: readonly AlphaRadarMemoChange[];
    convictionItems?: readonly AlphaRadarConvictionItem[];
    cloneClusters?: readonly AlphaRadarCloneCluster[];
    reportPeriodEndByPeriod?: Readonly<Record<string, string>>;
    filingAcceptedAtByFilingId?: Readonly<Record<string, string>>;
    minTopAddMateriality?: number;
    minConvictionScore?: number;
    minConsensusScore?: number;
}

export interface RunAlphaRadarBacktestInput {
    signals: readonly AlphaRadarBacktestSignal[];
    pricesByTicker: Readonly<Record<string, readonly AlphaRadarBacktestPricePoint[]>>;
    benchmarkPrices: readonly AlphaRadarBacktestPricePoint[];
    benchmarkTicker?: string;
    forwardWindowsDays?: readonly number[];
    availabilityLagDays?: number;
    generatedAt?: string;
}

const DEFAULT_FORWARD_WINDOWS = [30, 90, 180] as const;
const DEFAULT_AVAILABILITY_LAG_DAYS = 45;

export function buildAlphaRadarBacktestSignals(input: BuildAlphaRadarBacktestSignalsInput): AlphaRadarBacktestSignal[] {
    const minTopAddMateriality = input.minTopAddMateriality ?? 75;
    const minConvictionScore = input.minConvictionScore ?? 75;
    const minConsensusScore = input.minConsensusScore ?? 70;
    const signals: AlphaRadarBacktestSignal[] = [];

    for (const change of input.changes) {
        const common = {
            trackedFilerId: change.trackedFilerId,
            reportPeriod: change.reportPeriod,
            reportPeriodEnd: input.reportPeriodEndByPeriod?.[change.reportPeriod],
            filingAcceptedAt: acceptedAtForChange(change, input.filingAcceptedAtByFilingId),
            ticker: change.ticker,
            issuerName: change.issuerName,
            changeType: change.changeType,
            materialityScore: change.materialityScore,
            userOverlap: change.userRelevance.reasons.length > 0,
            source: 'holding-change' as const,
        };

        if (
            (change.changeType === 'new' || change.changeType === 'increased') &&
            change.materialityScore >= minTopAddMateriality
        ) {
            signals.push({
                ...common,
                id: `top-adds:${change.reportPeriod}:${change.trackedFilerId}:${change.cusip}`,
                scenario: 'top-adds',
                direction: 'long',
            });
        }

        if (change.changeType === 'exited' && change.materialityScore >= minTopAddMateriality) {
            signals.push({
                ...common,
                id: `exits:${change.reportPeriod}:${change.trackedFilerId}:${change.cusip}`,
                scenario: 'exits',
                direction: 'avoid-or-short',
            });
        }

        if (change.userRelevance.reasons.length > 0) {
            signals.push({
                ...common,
                id: `user-overlap:${change.reportPeriod}:${change.trackedFilerId}:${change.cusip}`,
                scenario: 'user-overlap',
                direction: change.changeType === 'exited' || change.changeType === 'decreased' ? 'avoid-or-short' : 'long',
            });
        }
    }

    for (const item of input.convictionItems ?? []) {
        if (item.convictionScore < minConvictionScore) continue;
        signals.push({
            id: `conviction:${item.reportPeriod}:${item.id}`,
            scenario: 'conviction',
            direction: item.changeType === 'exited' || item.changeType === 'decreased' ? 'avoid-or-short' : 'long',
            reportPeriod: item.reportPeriod,
            reportPeriodEnd: input.reportPeriodEndByPeriod?.[item.reportPeriod],
            ticker: item.ticker,
            issuerName: item.issuerName,
            changeType: item.changeType,
            materialityScore: item.convictionScore,
            convictionScore: item.convictionScore,
            userOverlap: item.userRelevanceScore > 0,
            source: 'conviction',
        });
    }

    for (const cluster of input.cloneClusters ?? []) {
        if (cluster.overlapScore < minConsensusScore) continue;
        if (cluster.direction !== 'consensus_buy' && cluster.direction !== 'consensus_sell') continue;
        signals.push({
            id: `consensus:${cluster.reportPeriod}:${cluster.cusip}`,
            scenario: 'consensus',
            direction: cluster.direction === 'consensus_sell' ? 'avoid-or-short' : 'long',
            reportPeriod: cluster.reportPeriod,
            reportPeriodEnd: input.reportPeriodEndByPeriod?.[cluster.reportPeriod],
            ticker: cluster.ticker,
            issuerName: cluster.issuerName,
            materialityScore: Math.round(cluster.overlapScore),
            consensusScore: Math.round(cluster.overlapScore),
            userOverlap: cluster.userOverlap.reasons.length > 0,
            source: 'clone-cluster',
        });
    }

    return dedupeSignals(signals);
}

export function runAlphaRadarBacktest(input: RunAlphaRadarBacktestInput): AlphaRadarBacktestResult {
    const windows = input.forwardWindowsDays ?? DEFAULT_FORWARD_WINDOWS;
    const availabilityLagDays = input.availabilityLagDays ?? DEFAULT_AVAILABILITY_LAG_DAYS;
    const benchmarkTicker = input.benchmarkTicker ?? 'SPY';
    const trades: AlphaRadarBacktestTradeResult[] = [];
    const skipped: AlphaRadarBacktestSkippedSignal[] = [];
    const benchmarkPrices = sortPrices(input.benchmarkPrices);

    for (const signal of input.signals) {
        for (const windowDays of windows) {
            const ticker = signal.ticker?.toUpperCase();
            if (!ticker) {
                skipped.push(createSkipped(signal, windowDays, 'missing-ticker'));
                continue;
            }

            const prices = sortPrices(input.pricesByTicker[ticker] ?? []);
            if (prices.length < 2) {
                skipped.push(createSkipped(signal, windowDays, 'missing-price-series'));
                continue;
            }

            const availabilityDate = getSignalAvailabilityDate(signal, availabilityLagDays);
            const entry = firstPriceOnOrAfter(prices, availabilityDate);
            if (!entry) {
                skipped.push(createSkipped(signal, windowDays, 'missing-entry-price-after-availability'));
                continue;
            }

            const exitTarget = addDays(entry.date, windowDays);
            const exit = firstPriceOnOrAfter(prices, exitTarget);
            if (!exit) {
                skipped.push(createSkipped(signal, windowDays, 'missing-exit-price'));
                continue;
            }

            const benchmarkEntry = firstPriceOnOrAfter(benchmarkPrices, entry.date);
            const benchmarkExit = benchmarkEntry ? firstPriceOnOrAfter(benchmarkPrices, exit.date) : undefined;
            const warnings: string[] = [];
            if (!benchmarkEntry || !benchmarkExit) warnings.push('missing-benchmark-window');
            if (prices.some((point) => point.splitAdjusted === false)) warnings.push('price-series-not-split-adjusted');

            const securityReturn = simpleReturn(entry.close, exit.close);
            const signalReturn = signal.direction === 'avoid-or-short' ? -securityReturn : securityReturn;
            const benchmarkReturn = benchmarkEntry && benchmarkExit
                ? simpleReturn(benchmarkEntry.close, benchmarkExit.close)
                : 0;
            const pathValues = prices
                .filter((point) => point.date >= entry.date && point.date <= exit.date)
                .map((point) => signal.direction === 'avoid-or-short'
                    ? 1 + simpleReturn(point.close, entry.close)
                    : point.close / entry.close);

            trades.push({
                signalId: signal.id,
                scenario: signal.scenario,
                ticker,
                issuerName: signal.issuerName,
                reportPeriod: signal.reportPeriod,
                direction: signal.direction,
                windowDays,
                availabilityDate,
                entryDate: entry.date,
                exitDate: exit.date,
                entryPrice: entry.close,
                exitPrice: exit.close,
                securityReturn,
                signalReturn,
                benchmarkReturn,
                relativeReturn: signalReturn - benchmarkReturn,
                maxDrawdown: maxDrawdown(pathValues),
                lagDays: daysBetween(getReportPeriodEnd(signal), entry.date),
                hit: signalReturn > benchmarkReturn,
                warnings,
            });
        }
    }

    return {
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        availabilityLagDays,
        benchmarkTicker,
        trades,
        skipped,
        summaries: summarizeBacktestTrades(trades, skipped),
        methodologyNote: 'Exploratory Alpha Radar backtests enter only after 13F reporting lag or filing acceptance. They are not trading recommendations.',
    };
}

function summarizeBacktestTrades(
    trades: readonly AlphaRadarBacktestTradeResult[],
    skipped: readonly AlphaRadarBacktestSkippedSignal[],
): AlphaRadarBacktestScenarioSummary[] {
    const keys = new Set<string>();
    for (const trade of trades) keys.add(`${trade.scenario}:${trade.windowDays}`);
    for (const item of skipped) keys.add(`${item.scenario}:${item.windowDays}`);

    return [...keys].sort().map((key) => {
        const [scenario, windowDaysText] = key.split(':') as [AlphaRadarBacktestScenario, string];
        const windowDays = Number(windowDaysText);
        const scenarioTrades = trades.filter((trade) => trade.scenario === scenario && trade.windowDays === windowDays);
        const scenarioSkipped = skipped.filter((item) => item.scenario === scenario && item.windowDays === windowDays);

        return {
            scenario,
            windowDays,
            completed: scenarioTrades.length,
            skipped: scenarioSkipped.length,
            hitRate: average(scenarioTrades.map((trade) => trade.hit ? 1 : 0)),
            averageSignalReturn: average(scenarioTrades.map((trade) => trade.signalReturn)),
            averageBenchmarkReturn: average(scenarioTrades.map((trade) => trade.benchmarkReturn)),
            averageRelativeReturn: average(scenarioTrades.map((trade) => trade.relativeReturn)),
            worstDrawdown: Math.min(0, ...scenarioTrades.map((trade) => trade.maxDrawdown)),
            averageLagDays: average(scenarioTrades.map((trade) => trade.lagDays)),
        };
    });
}

function acceptedAtForChange(
    change: AlphaRadarMemoChange,
    acceptedAtByFilingId: Readonly<Record<string, string>> | undefined,
): string | undefined {
    const filingId = change.currentFilingId ?? change.priorFilingId;
    return filingId ? acceptedAtByFilingId?.[filingId] : undefined;
}

function getSignalAvailabilityDate(signal: AlphaRadarBacktestSignal, availabilityLagDays: number): string {
    const laggedDate = addDays(getReportPeriodEnd(signal), availabilityLagDays);
    if (!signal.filingAcceptedAt) return laggedDate;
    return signal.filingAcceptedAt > laggedDate ? signal.filingAcceptedAt : laggedDate;
}

function getReportPeriodEnd(signal: AlphaRadarBacktestSignal): string {
    if (signal.reportPeriodEnd) return signal.reportPeriodEnd;
    const match = /^(\d{4})-Q([1-4])$/.exec(signal.reportPeriod);
    if (!match) return `${signal.reportPeriod}-01`;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    return new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
}

function firstPriceOnOrAfter(
    prices: readonly AlphaRadarBacktestPricePoint[],
    date: string,
): AlphaRadarBacktestPricePoint | undefined {
    return prices.find((point) => point.date >= date && Number.isFinite(point.close) && point.close > 0);
}

function sortPrices(prices: readonly AlphaRadarBacktestPricePoint[]): AlphaRadarBacktestPricePoint[] {
    return [...prices].sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    const endMs = Date.parse(`${end}T00:00:00.000Z`);
    return Math.round((endMs - startMs) / 86_400_000);
}

function createSkipped(
    signal: AlphaRadarBacktestSignal,
    windowDays: number,
    reason: string,
): AlphaRadarBacktestSkippedSignal {
    return {
        signalId: signal.id,
        scenario: signal.scenario,
        ticker: signal.ticker,
        issuerName: signal.issuerName,
        windowDays,
        reason,
    };
}

function dedupeSignals(signals: readonly AlphaRadarBacktestSignal[]): AlphaRadarBacktestSignal[] {
    const seen = new Set<string>();
    const out: AlphaRadarBacktestSignal[] = [];
    for (const signal of signals) {
        const key = `${signal.scenario}:${signal.reportPeriod}:${signal.ticker ?? signal.issuerName}:${signal.direction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(signal);
    }
    return out;
}

function average(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
