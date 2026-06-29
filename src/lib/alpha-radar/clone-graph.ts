import type { AlphaRadarMemoChange } from './memo';
import type { AlphaRadarTrackedFilerRecord } from './contracts';

export type AlphaRadarCloneDirection = 'consensus_buy' | 'consensus_sell' | 'mixed' | 'single_filer';

export type AlphaRadarCloneNodeKind = 'filer' | 'security' | 'user-signal';

export type AlphaRadarCloneEdgeKind =
    | 'changed'
    | 'portfolio-overlap'
    | 'watchlist-overlap'
    | 'thesis-overlap';

export interface AlphaRadarCloneNode {
    id: string;
    kind: AlphaRadarCloneNodeKind;
    label: string;
    group?: string;
    weight: number;
}

export interface AlphaRadarCloneEdge {
    id: string;
    from: string;
    to: string;
    kind: AlphaRadarCloneEdgeKind;
    weight: number;
    label: string;
}

export interface AlphaRadarCloneCluster {
    id: string;
    securityKey: string;
    ticker?: string;
    cusip: string;
    issuerName: string;
    reportPeriod: string;
    direction: AlphaRadarCloneDirection;
    filers: Array<{
        id: string;
        name: string;
        fundStyle: string;
        changeType: AlphaRadarMemoChange['changeType'];
        materialityScore: number;
    }>;
    fundStyles: string[];
    userOverlap: {
        portfolio: boolean;
        watchlist: boolean;
        thesis: boolean;
        reasons: string[];
    };
    overlapScore: number;
    materialityScore: number;
}

export interface AlphaRadarCloneGraph {
    nodes: AlphaRadarCloneNode[];
    edges: AlphaRadarCloneEdge[];
    clusters: AlphaRadarCloneCluster[];
}

export interface BuildAlphaRadarCloneGraphInput {
    filers: readonly AlphaRadarTrackedFilerRecord[];
    changes: readonly AlphaRadarMemoChange[];
    reportPeriod?: string;
    userPortfolioTickers?: readonly string[];
    userWatchlistTickers?: readonly string[];
    userThesisTickers?: readonly string[];
}

export function buildAlphaRadarCloneGraph(input: BuildAlphaRadarCloneGraphInput): AlphaRadarCloneGraph {
    const filersById = new Map(input.filers.map((filer) => [filer.id, filer]));
    const changes = input.reportPeriod
        ? input.changes.filter((change) => change.reportPeriod === input.reportPeriod)
        : [...input.changes];
    const clusters = buildClusters(changes, filersById, input);
    const nodes = buildNodes(clusters);
    const edges = buildEdges(clusters);

    return { nodes, edges, clusters };
}

export function filterAlphaRadarCloneClusters(
    clusters: readonly AlphaRadarCloneCluster[],
    fundStyle: string | 'all',
): AlphaRadarCloneCluster[] {
    if (fundStyle === 'all') return [...clusters];
    const normalized = normalizeStyle(fundStyle);
    return clusters.filter((cluster) => cluster.fundStyles.some((style) => normalizeStyle(style) === normalized));
}

function buildClusters(
    changes: readonly AlphaRadarMemoChange[],
    filersById: Map<string, AlphaRadarTrackedFilerRecord>,
    input: BuildAlphaRadarCloneGraphInput,
): AlphaRadarCloneCluster[] {
    const groups = new Map<string, AlphaRadarMemoChange[]>();
    for (const change of changes.filter((item) => item.changeType !== 'unchanged')) {
        const key = securityKey(change);
        groups.set(key, [...groups.get(key) ?? [], change]);
    }

    return [...groups.entries()].map(([key, group]) => {
        const representative = group[0];
        const filers = group.map((change) => {
            const filer = filersById.get(change.trackedFilerId);
            return {
                id: change.trackedFilerId,
                name: filer?.name ?? change.trackedFilerId,
                fundStyle: filer?.fundStyle ?? '13F manager',
                changeType: change.changeType,
                materialityScore: change.materialityScore,
            };
        }).sort((a, b) => {
            const scoreDelta = b.materialityScore - a.materialityScore;
            return scoreDelta !== 0 ? scoreDelta : a.name.localeCompare(b.name);
        });
        const fundStyles = [...new Set(filers.map((filer) => filer.fundStyle))].sort();
        const userOverlap = resolveUserOverlap(group, input);
        const materialityScore = round(group.reduce((sum, change) => sum + change.materialityScore, 0) / group.length);

        return {
            id: `clone:${representative.reportPeriod}:${key}`,
            securityKey: key,
            ticker: representative.ticker,
            cusip: representative.cusip,
            issuerName: representative.issuerName,
            reportPeriod: representative.reportPeriod,
            direction: resolveDirection(group),
            filers,
            fundStyles,
            userOverlap,
            overlapScore: scoreOverlap(group, userOverlap),
            materialityScore,
        };
    }).sort((a, b) => {
        const scoreDelta = b.overlapScore - a.overlapScore;
        if (scoreDelta !== 0) return scoreDelta;
        return displaySecurity(a).localeCompare(displaySecurity(b));
    });
}

function buildNodes(clusters: readonly AlphaRadarCloneCluster[]): AlphaRadarCloneNode[] {
    const nodes = new Map<string, AlphaRadarCloneNode>();
    for (const cluster of clusters) {
        nodes.set(`security:${cluster.securityKey}`, {
            id: `security:${cluster.securityKey}`,
            kind: 'security',
            label: displaySecurity(cluster),
            group: cluster.direction,
            weight: cluster.overlapScore,
        });
        for (const filer of cluster.filers) {
            nodes.set(`filer:${filer.id}`, {
                id: `filer:${filer.id}`,
                kind: 'filer',
                label: filer.name,
                group: filer.fundStyle,
                weight: filer.materialityScore,
            });
        }
        if (cluster.userOverlap.portfolio) addUserNode(nodes, 'portfolio');
        if (cluster.userOverlap.watchlist) addUserNode(nodes, 'watchlist');
        if (cluster.userOverlap.thesis) addUserNode(nodes, 'thesis');
    }
    return [...nodes.values()];
}

function buildEdges(clusters: readonly AlphaRadarCloneCluster[]): AlphaRadarCloneEdge[] {
    const edges: AlphaRadarCloneEdge[] = [];
    for (const cluster of clusters) {
        const securityNode = `security:${cluster.securityKey}`;
        for (const filer of cluster.filers) {
            edges.push({
                id: `edge:${filer.id}:${cluster.securityKey}`,
                from: `filer:${filer.id}`,
                to: securityNode,
                kind: 'changed',
                weight: filer.materialityScore,
                label: `${filer.name} ${filer.changeType}`,
            });
        }
        if (cluster.userOverlap.portfolio) edges.push(userEdge('portfolio', securityNode, cluster));
        if (cluster.userOverlap.watchlist) edges.push(userEdge('watchlist', securityNode, cluster));
        if (cluster.userOverlap.thesis) edges.push(userEdge('thesis', securityNode, cluster));
    }
    return edges;
}

function addUserNode(nodes: Map<string, AlphaRadarCloneNode>, kind: 'portfolio' | 'watchlist' | 'thesis'): void {
    nodes.set(`user:${kind}`, {
        id: `user:${kind}`,
        kind: 'user-signal',
        label: kind,
        group: 'user',
        weight: 100,
    });
}

function userEdge(
    kind: 'portfolio' | 'watchlist' | 'thesis',
    securityNode: string,
    cluster: AlphaRadarCloneCluster,
): AlphaRadarCloneEdge {
    return {
        id: `edge:user:${kind}:${cluster.securityKey}`,
        from: `user:${kind}`,
        to: securityNode,
        kind: `${kind}-overlap`,
        weight: cluster.overlapScore,
        label: `${kind} overlap`,
    };
}

function resolveDirection(group: readonly AlphaRadarMemoChange[]): AlphaRadarCloneDirection {
    const buys = group.filter((change) => change.changeType === 'new' || change.changeType === 'increased').length;
    const sells = group.filter((change) => change.changeType === 'exited' || change.changeType === 'decreased').length;
    if (group.length === 1) return 'single_filer';
    if (buys > 0 && sells === 0) return 'consensus_buy';
    if (sells > 0 && buys === 0) return 'consensus_sell';
    return 'mixed';
}

function resolveUserOverlap(
    group: readonly AlphaRadarMemoChange[],
    input: BuildAlphaRadarCloneGraphInput,
): AlphaRadarCloneCluster['userOverlap'] {
    const ticker = group[0].ticker?.toUpperCase();
    const portfolio = group.some((change) => change.userRelevance.portfolio)
        || includesTicker(input.userPortfolioTickers, ticker);
    const watchlist = group.some((change) => change.userRelevance.watchlist)
        || includesTicker(input.userWatchlistTickers, ticker);
    const thesis = group.some((change) => change.userRelevance.thesis)
        || includesTicker(input.userThesisTickers, ticker);
    const reasons = new Set(group.flatMap((change) => change.userRelevance.reasons));
    if (portfolio) reasons.add('portfolio overlap');
    if (watchlist) reasons.add('watchlist overlap');
    if (thesis) reasons.add('active thesis');
    return { portfolio, watchlist, thesis, reasons: [...reasons].sort() };
}

function scoreOverlap(
    group: readonly AlphaRadarMemoChange[],
    userOverlap: AlphaRadarCloneCluster['userOverlap'],
): number {
    const filerBonus = Math.min(group.length - 1, 4) * 12;
    const directionBonus = resolveDirection(group).startsWith('consensus') ? 10 : 0;
    const userBonus = [
        userOverlap.portfolio ? 18 : 0,
        userOverlap.watchlist ? 12 : 0,
        userOverlap.thesis ? 16 : 0,
    ].reduce((sum, value) => sum + value, 0);
    const materiality = group.reduce((sum, change) => sum + change.materialityScore, 0) / Math.max(group.length, 1);
    return Math.min(100, round(materiality * 0.55 + filerBonus + directionBonus + userBonus));
}

function securityKey(change: AlphaRadarMemoChange): string {
    return (change.ticker ?? change.cusip).trim().toUpperCase();
}

function displaySecurity(cluster: Pick<AlphaRadarCloneCluster, 'ticker' | 'issuerName'>): string {
    return cluster.ticker ? `${cluster.issuerName} (${cluster.ticker})` : cluster.issuerName;
}

function includesTicker(tickers: readonly string[] | undefined, ticker: string | undefined): boolean {
    if (!ticker) return false;
    return new Set((tickers ?? []).map((item) => item.toUpperCase())).has(ticker);
}

function normalizeStyle(style: string): string {
    return style.trim().toLowerCase();
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
