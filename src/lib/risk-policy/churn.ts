import type { PolicyBucketId } from "./buckets";
import type { ThemeId } from "./themes";
import type { Mood, SetupType, TradeRationale } from "@/types/trade";

export type ChurnStatus = "inside" | "watch" | "breached" | "missing_data";

export const CHURN_FLAG_LABELS = {
    repeated_loop: "Repeated buy/sell loop",
    high_activity: "High same-name activity",
    reopened_quickly: "Reopened soon after sale",
    missing_thesis_add: "Add without written thesis",
    caution_mood: "Caution mood",
    low_adherence: "Low adherence",
    worsened_policy_breach: "Worsened breached policy",
    short_holding_period: "Short holding-period tax friction",
    rebalance_labeled: "Rebalance-labeled activity",
} as const;

export type ChurnFlag = keyof typeof CHURN_FLAG_LABELS;

export interface ChurnTrade {
    id?: string;
    date: string | Date;
    type: "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | string;
    ticker?: string | null;
    symbol?: string | null;
    amount?: number | null;
    quantity?: number | null;
    price?: number | null;
    account?: string | null;
    policyBucket?: PolicyBucketId | null;
    theme?: ThemeId | null;
    setupType?: SetupType | string | null;
    mood?: Mood | string | null;
    thesisId?: string | null;
    thesisUpdatedAt?: string | Date | null;
    rationale?: TradeRationale | null;
    adherenceScore?: number | null;
    holdingPeriodDays?: number | null;
    policyExceptions?: readonly unknown[] | null;
    notes?: string | null;
}

export interface ChurnAnalyzerOptions {
    windowDays?: number;
    watchRepeatSymbols?: number;
    breachRepeatSymbols?: number;
    reopenDays?: number;
    shortHoldingDays?: number;
    lowAdherenceScore?: number;
    asOf?: Date | string;
}

export interface ChurnTickerRow {
    symbol: string;
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    roundTrips: number;
    turnoverUsd: number;
    lastTradeDate: string;
    churnScore: number;
    status: Exclude<ChurnStatus, "missing_data">;
    flags: ChurnFlag[];
    accounts: string[];
    buckets: PolicyBucketId[];
    themes: ThemeId[];
    cooldownUntil?: string;
    recommendation: string;
}

export interface ChurnGroupRow {
    key: string;
    turnoverUsd: number;
    tradeCount: number;
    symbols: string[];
}

export interface ChurnAnalysis {
    status: ChurnStatus;
    windowDays: number;
    totalTrades: number;
    repeatSymbolCount: number;
    repeatSymbols: string[];
    repeatTurnoverUsd: number;
    maxChurnScore: number;
    rows: ChurnTickerRow[];
    bucketRows: ChurnGroupRow[];
    themeRows: ChurnGroupRow[];
    actionPrompts: string[];
}

interface NormalizedChurnTrade {
    id?: string;
    date: Date;
    dateKey: string;
    type: "buy" | "sell";
    symbol: string;
    turnoverUsd: number;
    account?: string;
    policyBucket?: PolicyBucketId;
    theme?: ThemeId;
    setupType?: string;
    mood?: string;
    thesisId?: string;
    thesisUpdatedAt?: Date;
    adherenceScore?: number;
    holdingPeriodDays?: number;
    policyExceptionCount: number;
    notes?: string;
}

const DEFAULT_OPTIONS: Required<Omit<ChurnAnalyzerOptions, "asOf">> = {
    windowDays: 90,
    watchRepeatSymbols: 1,
    breachRepeatSymbols: 3,
    reopenDays: 30,
    shortHoldingDays: 30,
    lowAdherenceScore: 80,
};

const CAUTION_MOODS = new Set(["fomo", "revenge", "frustrated"]);

export function computeChurnAnalysis(
    trades: readonly ChurnTrade[],
    options: ChurnAnalyzerOptions = {},
): ChurnAnalysis {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const normalizedAll = trades
        .map(normalizeTrade)
        .filter((trade): trade is NormalizedChurnTrade => trade != null)
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (normalizedAll.length === 0) {
        return emptyAnalysis(opts.windowDays);
    }

    const anchor = normalizeDate(options.asOf)
        ?? normalizedAll.reduce((latest, trade) => trade.date > latest ? trade.date : latest, normalizedAll[0].date);
    const cutoff = new Date(anchor.getTime() - opts.windowDays * 86_400_000);
    const windowed = normalizedAll.filter((trade) => trade.date >= cutoff && trade.date <= anchor);

    if (windowed.length === 0) {
        return emptyAnalysis(opts.windowDays);
    }

    const rows = [...groupBySymbol(windowed).entries()]
        .map(([symbol, symbolTrades]) => buildTickerRow(symbol, symbolTrades, opts))
        .filter((row) => row.tradeCount >= 2 || row.churnScore > 0)
        .sort((a, b) => {
            const scoreDiff = b.churnScore - a.churnScore;
            return scoreDiff !== 0 ? scoreDiff : b.turnoverUsd - a.turnoverUsd;
        });

    const repeatRows = rows.filter((row) => row.tradeCount >= 2);
    const repeatSymbolCount = repeatRows.length;
    const repeatTurnoverUsd = roundMoney(repeatRows.reduce((sum, row) => sum + row.turnoverUsd, 0));
    const maxChurnScore = rows[0]?.churnScore ?? 0;
    const status = classifyAnalysisStatus({
        hasTrades: windowed.length > 0,
        repeatSymbolCount,
        maxChurnScore,
        watchRepeatSymbols: opts.watchRepeatSymbols,
        breachRepeatSymbols: opts.breachRepeatSymbols,
    });

    return {
        status,
        windowDays: opts.windowDays,
        totalTrades: windowed.length,
        repeatSymbolCount,
        repeatSymbols: repeatRows.map((row) => row.symbol),
        repeatTurnoverUsd,
        maxChurnScore,
        rows,
        bucketRows: buildGroupRows(windowed, "policyBucket"),
        themeRows: buildGroupRows(windowed, "theme"),
        actionPrompts: buildActionPrompts(rows, status),
    };
}

function buildTickerRow(
    symbol: string,
    trades: NormalizedChurnTrade[],
    opts: Required<Omit<ChurnAnalyzerOptions, "asOf">>,
): ChurnTickerRow {
    const buys = trades.filter((trade) => trade.type === "buy");
    const sells = trades.filter((trade) => trade.type === "sell");
    const roundTrips = Math.min(buys.length, sells.length);
    const flags = new Set<ChurnFlag>();

    if (roundTrips > 0) flags.add("repeated_loop");
    if (trades.length >= 3) flags.add("high_activity");
    if (hasQuickReopen(trades, opts.reopenDays)) flags.add("reopened_quickly");
    if (buys.some((trade) => !trade.thesisId && !hasRecentThesisUpdate(trade))) flags.add("missing_thesis_add");
    if (trades.some((trade) => trade.mood && CAUTION_MOODS.has(trade.mood))) flags.add("caution_mood");
    if (trades.some((trade) => trade.adherenceScore != null && trade.adherenceScore < opts.lowAdherenceScore)) {
        flags.add("low_adherence");
    }
    if (trades.some((trade) => trade.policyExceptionCount > 0)) flags.add("worsened_policy_breach");
    if (trades.some((trade) => trade.holdingPeriodDays != null && trade.holdingPeriodDays < opts.shortHoldingDays)) {
        flags.add("short_holding_period");
    }
    if (trades.some(isRebalanceLabeled)) flags.add("rebalance_labeled");

    const turnoverUsd = roundMoney(trades.reduce((sum, trade) => sum + trade.turnoverUsd, 0));
    const churnScore = scoreChurn({
        tradeCount: trades.length,
        roundTrips,
        flags: [...flags],
    });
    const status = churnScore >= 70 ? "breached" : churnScore >= 35 ? "watch" : "inside";
    const lastTrade = trades[trades.length - 1];
    const cooldownUntil = status === "inside"
        ? undefined
        : addDays(lastTrade.date, opts.reopenDays).toISOString().slice(0, 10);

    return {
        symbol,
        tradeCount: trades.length,
        buyCount: buys.length,
        sellCount: sells.length,
        roundTrips,
        turnoverUsd,
        lastTradeDate: lastTrade.dateKey,
        churnScore,
        status,
        flags: [...flags],
        accounts: uniqueDefined(trades.map((trade) => trade.account)),
        buckets: uniqueDefined(trades.map((trade) => trade.policyBucket)),
        themes: uniqueDefined(trades.map((trade) => trade.theme)),
        cooldownUntil,
        recommendation: buildRecommendation(symbol, status, [...flags], cooldownUntil),
    };
}

function scoreChurn({
    tradeCount,
    roundTrips,
    flags,
}: {
    tradeCount: number;
    roundTrips: number;
    flags: ChurnFlag[];
}): number {
    const flagSet = new Set(flags);
    let score = 0;
    score += Math.max(0, tradeCount - 1) * 14;
    score += roundTrips * 22;
    if (flagSet.has("reopened_quickly")) score += 18;
    if (flagSet.has("missing_thesis_add")) score += 12;
    if (flagSet.has("caution_mood")) score += 16;
    if (flagSet.has("low_adherence")) score += 16;
    if (flagSet.has("worsened_policy_breach")) score += 18;
    if (flagSet.has("short_holding_period")) score += 12;
    if (flagSet.has("rebalance_labeled")) score -= 25;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function buildRecommendation(
    symbol: string,
    status: ChurnTickerRow["status"],
    flags: ChurnFlag[],
    cooldownUntil?: string,
): string {
    if (status === "inside") {
        return `${symbol} activity is inside the current churn policy.`;
    }
    if (flags.includes("rebalance_labeled") && !flags.includes("missing_thesis_add")) {
        return `Review ${symbol} as intentional rebalancing and keep notes attached.`;
    }
    const cooldown = cooldownUntil ? ` until ${cooldownUntil}` : "";
    return `Cooldown ${symbol}${cooldown} unless a thesis update is written.`;
}

function hasQuickReopen(trades: readonly NormalizedChurnTrade[], reopenDays: number): boolean {
    for (let i = 0; i < trades.length; i += 1) {
        const sell = trades[i];
        if (sell.type !== "sell") continue;
        const limit = sell.date.getTime() + reopenDays * 86_400_000;
        if (trades.slice(i + 1).some((trade) => trade.type === "buy" && trade.date.getTime() <= limit)) {
            return true;
        }
    }
    return false;
}

function hasRecentThesisUpdate(trade: NormalizedChurnTrade): boolean {
    if (!trade.thesisUpdatedAt) return false;
    return trade.thesisUpdatedAt.getTime() <= trade.date.getTime();
}

function isRebalanceLabeled(trade: NormalizedChurnTrade): boolean {
    return trade.setupType === "rebalance" || /\brebalanc/i.test(trade.notes ?? "");
}

function buildGroupRows(
    trades: readonly NormalizedChurnTrade[],
    field: "policyBucket" | "theme",
): ChurnGroupRow[] {
    const byKey = new Map<string, { turnoverUsd: number; tradeCount: number; symbols: Set<string> }>();
    for (const trade of trades) {
        const key = trade[field];
        if (!key) continue;
        const current = byKey.get(key) ?? { turnoverUsd: 0, tradeCount: 0, symbols: new Set<string>() };
        current.turnoverUsd += trade.turnoverUsd;
        current.tradeCount += 1;
        current.symbols.add(trade.symbol);
        byKey.set(key, current);
    }

    return [...byKey.entries()]
        .map(([key, value]) => ({
            key,
            turnoverUsd: roundMoney(value.turnoverUsd),
            tradeCount: value.tradeCount,
            symbols: [...value.symbols].sort(),
        }))
        .sort((a, b) => b.turnoverUsd - a.turnoverUsd);
}

function buildActionPrompts(rows: readonly ChurnTickerRow[], status: ChurnStatus): string[] {
    if (status === "missing_data") return ["Connect trade history before evaluating churn."];
    return rows
        .filter((row) => row.status !== "inside")
        .slice(0, 4)
        .map((row) => row.recommendation);
}

function classifyAnalysisStatus({
    hasTrades,
    repeatSymbolCount,
    maxChurnScore,
    watchRepeatSymbols,
    breachRepeatSymbols,
}: {
    hasTrades: boolean;
    repeatSymbolCount: number;
    maxChurnScore: number;
    watchRepeatSymbols: number;
    breachRepeatSymbols: number;
}): ChurnStatus {
    if (!hasTrades) return "missing_data";
    if (repeatSymbolCount >= breachRepeatSymbols || maxChurnScore >= 70) return "breached";
    if (repeatSymbolCount >= watchRepeatSymbols || maxChurnScore >= 35) return "watch";
    return "inside";
}

function groupBySymbol(trades: readonly NormalizedChurnTrade[]): Map<string, NormalizedChurnTrade[]> {
    const bySymbol = new Map<string, NormalizedChurnTrade[]>();
    for (const trade of trades) {
        const current = bySymbol.get(trade.symbol) ?? [];
        current.push(trade);
        bySymbol.set(trade.symbol, current);
    }
    return bySymbol;
}

function normalizeTrade(trade: ChurnTrade): NormalizedChurnTrade | null {
    const type = String(trade.type).toLowerCase();
    if (type !== "buy" && type !== "sell") return null;
    const symbol = normalizeSymbol(trade.ticker ?? trade.symbol);
    const date = normalizeDate(trade.date);
    if (!symbol || !date) return null;

    const rationale = trade.rationale;
    const amount = Math.abs(Number(trade.amount ?? 0));
    const quantity = Math.abs(Number(trade.quantity ?? 0));
    const price = Math.abs(Number(trade.price ?? 0));
    const turnoverUsd = safeMoney(amount > 0 ? amount : quantity * price);

    return {
        id: trade.id,
        date,
        dateKey: date.toISOString().slice(0, 10),
        type,
        symbol,
        turnoverUsd,
        account: trade.account?.trim() || undefined,
        policyBucket: trade.policyBucket ?? undefined,
        theme: trade.theme ?? undefined,
        setupType: trade.setupType?.toString() ?? rationale?.setupType,
        mood: trade.mood?.toString().toLowerCase() ?? rationale?.mood,
        thesisId: trade.thesisId ?? rationale?.thesisId,
        thesisUpdatedAt: normalizeDate(trade.thesisUpdatedAt ?? undefined),
        adherenceScore: numberOrUndefined(trade.adherenceScore),
        holdingPeriodDays: numberOrUndefined(trade.holdingPeriodDays),
        policyExceptionCount: trade.policyExceptions?.length ?? 0,
        notes: trade.notes ?? undefined,
    };
}

function emptyAnalysis(windowDays: number): ChurnAnalysis {
    return {
        status: "missing_data",
        windowDays,
        totalTrades: 0,
        repeatSymbolCount: 0,
        repeatSymbols: [],
        repeatTurnoverUsd: 0,
        maxChurnScore: 0,
        rows: [],
        bucketRows: [],
        themeRows: [],
        actionPrompts: ["Connect trade history before evaluating churn."],
    };
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function normalizeDate(value?: Date | string | null): Date | undefined {
    if (value instanceof Date) return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function addDays(value: Date, days: number): Date {
    return new Date(value.getTime() + days * 86_400_000);
}

function safeMoney(value: number): number {
    return roundMoney(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function uniqueDefined<T extends string>(values: Array<T | undefined>): T[] {
    return [...new Set(values.filter((value): value is T => Boolean(value)))].sort();
}
