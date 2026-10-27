/**
 * AR-115 — fixed tool catalogue for Ask Ledger.
 *
 * Deliberately narrow: the planner may only invoke one of these
 * functions, and every return shape is `AskRow[]`. That shape shows up
 * in the rendered answer as a `kv` table without the renderer needing
 * tool-specific knowledge.
 *
 * All tools are pure: they read the user's own data from the context
 * (launch item i56) — their holdings, cash, transactions and closed
 * trades, the theses they wrote, and the risk policy they saved — which
 * the server loads (./server/context.ts). They never fill a gap with
 * example data: no data is an empty answer, which the renderer says.
 */
import { sectorFor } from '@/lib/holdings/sector';
import { searchAlphaRadarSemanticChunks, type AlphaRadarSemanticChunk } from '@/lib/alpha-radar/memory';
import type { ActivityRow } from '@/lib/portfolio/activity';
import type { ClosedTrade } from '@/lib/portfolio/closed-trades';
import type { StoredClose } from '@/lib/portfolio/valuation-snapshots';
import {
    buildCustomStressScenario,
    computeCashPolicySummary,
    computeChurnAnalysis,
    computeThemeExposure,
    computeTrimAmountToTarget,
    employerStockName,
    employerSymbols,
    evaluateRiskPolicy,
    findStressScenario,
    normalizeTicker,
    policyHoldings,
    policyPortfolioValue,
    runStressScenario,
    type PolicyPortfolio,
    type RiskPolicySettings,
    type ThemeExposureHolding,
} from '@/lib/risk-policy';
import type {
    AskRow,
    AskToolName,
    AskToolRun,
} from './types';

export interface AskContext {
    /** Holdings valued as Today values them, cash, the last year's buys and sells, and the user's theses. */
    portfolio: PolicyPortfolio;
    /** Every transaction, newest first. */
    activity: ActivityRow[];
    /** Sales matched against the buys before them, newest first. */
    closedTrades: ClosedTrade[];
    /** The risk policy the user saved: caps, bucket choices, employer tickers, cash jobs. */
    policy: RiskPolicySettings;
    /** Sectors from the securities master, by ticker; `sectorFor` for the rest. */
    sectors?: Readonly<Record<string, string>>;
    /** Stored daily closes, oldest first, for the tickers a correlation needs. */
    closes?: ReadonlyMap<string, readonly StoredClose[]>;
    alphaRadarMemory?: AlphaRadarSemanticChunk[];
    /** Unix ms. Frozen per run so outputs are stable. */
    now: number;
}

// --------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------- //

function usd(n: number): string {
    if (!Number.isFinite(n)) return '$0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    return `${sign}$${abs}`;
}

function usdSigned(n: number): string {
    if (n === 0) return '$0';
    const sign = n > 0 ? '+' : '-';
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    return `${sign}$${abs}`;
}

function pct(n: number): string {
    if (!Number.isFinite(n)) return '0%';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function inRange(trade: ClosedTrade, rangeDays: number, now: number): boolean {
    if (rangeDays <= 0) return true; // all time
    const ms = now - Date.parse(trade.closedAt);
    return ms >= 0 && ms <= rangeDays * 86_400_000;
}

function sectorOf(ctx: AskContext, symbol: string): string {
    return ctx.sectors?.[normalizeTicker(symbol)] ?? sectorFor(symbol);
}

interface Position {
    symbol: string;
    name: string;
    quantity: number;
    costBasis: number;
    marketValue: number;
}

/** One position per ticker, across the user's accounts. */
function positions(ctx: AskContext): Position[] {
    const bySymbol = new Map<string, Position>();
    for (const holding of ctx.portfolio.holdings) {
        const symbol = normalizeTicker(holding.symbol);
        const position = bySymbol.get(symbol) ?? { symbol, name: holding.name, quantity: 0, costBasis: 0, marketValue: 0 };
        position.quantity += holding.quantity;
        position.costBasis += holding.quantity * holding.avgCost;
        position.marketValue += holding.marketValue;
        bySymbol.set(symbol, position);
    }
    return [...bySymbol.values()];
}

/** The user's holdings as the policy sees them, cash included, as on Today. */
function policyExposureHoldings(ctx: AskContext): ThemeExposureHolding[] {
    const cash = ctx.portfolio.cashTotal;
    return [
        ...policyHoldings(ctx.portfolio.holdings, ctx.policy),
        ...(cash > 0
            ? [{
                id: 'cash-reserve',
                symbol: 'USD',
                name: 'Cash reserve',
                marketValue: cash,
                policyBucket: 'cash_reserve' as const,
                themeWeights: [{ theme: 'bonds_treasuries_cash_equivalent' as const, weight: 1, source: 'fallback' as const }],
            }]
            : []),
    ];
}

export const NO_EMPLOYER_LABEL = 'No employer stock named';

/** The answer to an employer-stock question before the user has named theirs. */
const NO_EMPLOYER_ROW: AskRow = {
    label: NO_EMPLOYER_LABEL,
    value: 'None',
    sub: "Name your employer's tickers in Settings › Employer stock, or ask about a ticker",
    tone: 'neutral',
    href: '/settings#employer-stock',
};

// --------------------------------------------------------------------- //
// 1. top_alpha_contributors
// --------------------------------------------------------------------- //

/**
 * Who moved the number most? Rank positions by unrealized return (value
 * less cost) and return the top N. Used by "what's helped / hurt" questions.
 */
export function top_alpha_contributors(
    ctx: AskContext,
    args: { topN?: number; direction?: 'positive' | 'negative' | 'all' } = {},
): AskRow[] {
    const topN = args.topN ?? 5;
    const direction = args.direction ?? 'all';
    const gain = (p: Position) => p.marketValue - p.costBasis;

    // Different directions want different sorts. For "negative" we want
    // the WORST performers first; when the book is all-green that means
    // the weakest winners ("relative drags"), not an empty reply.
    let pool = positions(ctx).filter((p) => p.costBasis > 0);
    if (direction === 'positive') {
        pool = pool.filter((p) => gain(p) >= 0);
        pool.sort((a, b) => gain(b) - gain(a) || a.symbol.localeCompare(b.symbol));
    } else if (direction === 'negative') {
        pool.sort((a, b) => gain(a) - gain(b) || a.symbol.localeCompare(b.symbol));
    } else {
        pool.sort((a, b) => Math.abs(gain(b)) - Math.abs(gain(a)) || a.symbol.localeCompare(b.symbol));
    }

    return pool.slice(0, topN).map((p) => ({
        label: p.symbol,
        value: usdSigned(gain(p)),
        sub: `${pct((gain(p) / p.costBasis) * 100)} · ${p.name}`,
        tone: gain(p) >= 0 ? 'pos' : 'neg',
        href: `/portfolios/detail/${encodeURIComponent(p.symbol)}`,
    }));
}

// --------------------------------------------------------------------- //
// 2. pnl_attribution
// --------------------------------------------------------------------- //

/**
 * Where did P&L come from over the last `rangeDays`? Groups the closed
 * trades by `sector | ticker | setup` and sums the realized gain. No setup
 * is recorded with a transaction, so by setup they are all "No setup recorded".
 */
export function pnl_attribution(
    ctx: AskContext,
    args: { rangeDays?: number; groupBy?: 'sector' | 'ticker' | 'setup' } = {},
): AskRow[] {
    const rangeDays = args.rangeDays ?? 30;
    const groupBy = args.groupBy ?? 'sector';
    const windowed = ctx.closedTrades.filter((t) => inRange(t, rangeDays, ctx.now));

    const bucket = new Map<string, number>();
    for (const t of windowed) {
        const key = groupBy === 'ticker' ? t.symbol : groupBy === 'setup' ? 'No setup recorded' : sectorOf(ctx, t.symbol);
        bucket.set(key, (bucket.get(key) ?? 0) + t.realizedPnl);
    }

    return Array.from(bucket.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({
            label,
            value: usdSigned(value),
            tone: value >= 0 ? 'pos' : 'neg',
            href:
                groupBy === 'sector'
                    ? `/portfolios/holdings?sector=${encodeURIComponent(label)}`
                    : `/portfolios/activity`,
        }));
}

// --------------------------------------------------------------------- //
// 3. sector_exposure
// --------------------------------------------------------------------- //

/** Allocation % by sector, computed from current market values. */
export function sector_exposure(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    const bucket = new Map<string, number>();
    let total = 0;
    for (const p of positions(ctx)) {
        const sector = sectorOf(ctx, p.symbol);
        bucket.set(sector, (bucket.get(sector) ?? 0) + p.marketValue);
        total += p.marketValue;
    }
    if (total === 0) return [];
    return Array.from(bucket.entries())
        .map(([s, v]) => ({ s, v, pct: (v / total) * 100 }))
        .sort((a, b) => b.v - a.v)
        .map((r) => ({
            label: r.s,
            value: `${r.pct.toFixed(1)}%`,
            sub: usd(r.v),
            // Tint red when any one sector exceeds 40% — a blunt
            // concentration warning. The adherence rules have their own
            // per-user threshold; this is just the conversational signal.
            tone: r.pct > 40 ? 'warn' : 'neutral',
            href: `/portfolios/holdings?sector=${encodeURIComponent(r.s)}`,
        }));
}

// --------------------------------------------------------------------- //
// 4. trades_matching
// --------------------------------------------------------------------- //

/**
 * Closed trades that match a filter:
 *   - `ticker` (exact match, case-insensitive)
 *   - `rangeDays`
 *   - `outcome` ('win' | 'loss')
 *   - `setup`: no setup is recorded with a transaction, so nothing matches
 */
export function trades_matching(
    ctx: AskContext,
    args: {
        setup?: string;
        ticker?: string;
        rangeDays?: number;
        outcome?: 'win' | 'loss';
    } = {},
): AskRow[] {
    if (args.setup) return [];
    const rangeDays = args.rangeDays ?? 0;
    return ctx.closedTrades
        .filter((t) => {
            if (!inRange(t, rangeDays, ctx.now)) return false;
            if (args.ticker && t.symbol !== normalizeTicker(args.ticker)) return false;
            if (args.outcome === 'win' && t.realizedPnl <= 0) return false;
            if (args.outcome === 'loss' && t.realizedPnl >= 0) return false;
            return true;
        })
        .slice(0, 10)
        .map((t) => ({
            label: `Sold ${formatShares(t.quantity)} ${t.symbol}`,
            value: usdSigned(t.realizedPnl),
            sub: `${new Date(t.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · ${t.account}`,
            tone: t.realizedPnl >= 0 ? 'pos' : 'neg',
            href: `/portfolios/activity`,
        }));
}

function formatShares(quantity: number): string {
    return Number.isInteger(quantity) ? quantity.toLocaleString('en-US') : quantity.toFixed(4).replace(/0+$/, '');
}

// --------------------------------------------------------------------- //
// 5. correlation_with
// --------------------------------------------------------------------- //

/** Most recent daily returns the correlation is measured over. */
export const CORRELATION_SESSIONS = 90;
/** Fewest shared daily returns worth a correlation. */
export const MIN_CORRELATION_RETURNS = 20;

/** Daily returns by date: each close against the one before it. */
function dailyReturns(closes: readonly StoredClose[] | undefined): Map<string, number> {
    const returns = new Map<string, number>();
    const sorted = [...(closes ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i - 1].close > 0) returns.set(sorted[i].date, sorted[i].close / sorted[i - 1].close - 1);
    }
    return returns;
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
    const n = xs.length;
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * How each holding's daily returns moved with the requested ticker's over
 * the last CORRELATION_SESSIONS sessions of stored closes. A holding with
 * fewer than MIN_CORRELATION_RETURNS shared days is left out.
 */
export function correlation_with(
    ctx: AskContext,
    args: { symbol?: string } = {},
): AskRow[] {
    const target = normalizeTicker(args.symbol);
    if (!target) return [];
    const targetReturns = dailyReturns(ctx.closes?.get(target));
    const recent = [...targetReturns.keys()].sort().slice(-CORRELATION_SESSIONS);
    const total = positions(ctx).reduce((s, p) => s + p.marketValue, 0);
    return positions(ctx)
        .filter((p) => p.symbol !== target)
        .flatMap((p): Array<{ coef: number; row: AskRow }> => {
            const own = dailyReturns(ctx.closes?.get(p.symbol));
            const shared = recent.filter((date) => own.has(date));
            if (shared.length < MIN_CORRELATION_RETURNS) return [];
            const coef = pearson(shared.map((d) => targetReturns.get(d)!), shared.map((d) => own.get(d)!));
            if (coef === null) return [];
            return [{
                coef,
                row: {
                    label: p.symbol,
                    value: coef.toFixed(2),
                    sub: `${shared.length} sessions · ${total > 0 ? ((p.marketValue / total) * 100).toFixed(1) : '0.0'}% of holdings`,
                    tone: coef >= 0.6 ? 'warn' : 'neutral',
                    href: `/portfolios/detail/${encodeURIComponent(p.symbol)}`,
                },
            }];
        })
        .sort((a, b) => b.coef - a.coef)
        .slice(0, 5)
        .map(({ row }) => row);
}

// --------------------------------------------------------------------- //
// 6. alpha_radar_evidence_search
// --------------------------------------------------------------------- //

/** Search Alpha Radar semantic memory with deterministic keyword fallback. */
export function alpha_radar_evidence_search(
    ctx: AskContext,
    args: { query?: string; limit?: number } = {},
): AskRow[] {
    const query = args.query?.trim();
    if (!query) return [];

    const result = searchAlphaRadarSemanticChunks({
        query,
        chunks: ctx.alphaRadarMemory ?? [],
        limit: args.limit ?? 5,
    });

    return result.matches.map((match) => ({
        label: match.citation.title,
        value: match.score.toFixed(2),
        sub: match.text,
        tone: 'neutral',
        href: match.citation.url ?? '/research?tab=alpha-radar',
    }));
}

// --------------------------------------------------------------------- //
// 7. policy_breaches
// --------------------------------------------------------------------- //

export function policy_breaches(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    if (ctx.portfolio.holdings.length === 0) return [];
    const dashboard = evaluateRiskPolicy(ctx.portfolio, ctx.policy, { asOf: new Date(ctx.now) });

    return dashboard.dimensions
        .filter((dimension) => dimension.status !== 'inside')
        .sort((a, b) => statusRank(b.status) - statusRank(a.status))
        .map((dimension) => ({
            label: dimension.label,
            value: dimension.status.replace('_', ' '),
            sub: `${dimension.currentLabel ?? (dimension.currentPct == null ? 'n/a' : `${dimension.currentPct.toFixed(1)}%`)} · target ${dimension.targetLabel}`,
            tone: dimension.status === 'breached' || dimension.status === 'missing_data' ? 'warn' : 'neutral',
            href: dimension.href,
        }));
}

// --------------------------------------------------------------------- //
// 8. stress_test
// --------------------------------------------------------------------- //

/**
 * A built-in scenario, the employer's when the user named theirs, or a
 * 40% drop in one ticker (`symbol`).
 */
export function stress_test(
    ctx: AskContext,
    args: { scenarioId?: string; symbol?: string } = {},
): AskRow[] {
    if (ctx.portfolio.holdings.length === 0) return [];
    const employer = employerSymbols(ctx.policy);
    const symbol = normalizeTicker(args.symbol);
    const wantsEmployer = (symbol !== '' && employer.includes(symbol)) || (!symbol && args.scenarioId === 'employer_40_down');
    if (wantsEmployer && employer.length === 0) return [NO_EMPLOYER_ROW];
    const scenario = symbol && !wantsEmployer
        ? buildCustomStressScenario({ id: 'ticker_40_down', label: `${symbol} -40%`, kind: 'ticker', value: symbol, shockPct: -40 })
        : findStressScenario(wantsEmployer ? 'employer_40_down' : args.scenarioId, employer);
    const result = runStressScenario({
        holdings: policyHoldings(ctx.portfolio.holdings, ctx.policy),
        cashTotal: ctx.portfolio.cashTotal,
        scenario,
    });

    const rows: AskRow[] = [
        {
            label: result.label,
            value: usdSigned(result.totalImpactUsd),
            sub: `${result.portfolioImpactPct.toFixed(1)}% portfolio impact`,
            tone: result.totalImpactUsd < 0 ? 'neg' : 'neutral',
            href: result.mitigationHref ?? '/portfolios/holdings',
        },
    ];

    return rows.concat(result.contributors.slice(0, 5).map((contributor) => ({
        label: contributor.symbol,
        value: usdSigned(contributor.impactUsd),
        sub: `${contributor.effectiveShockPct.toFixed(1)}% shock · ${contributor.matchedTargets.join(', ')}`,
        tone: contributor.impactUsd < 0 ? 'neg' : 'neutral',
        href: '/portfolios/holdings',
    })));
}

// --------------------------------------------------------------------- //
// 9. theme_exposure
// --------------------------------------------------------------------- //

export function theme_exposure(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    if (ctx.portfolio.holdings.length === 0) return [];
    const exposure = computeThemeExposure(policyExposureHoldings(ctx), ctx.policy.themeCaps);
    return exposure.rows
        .filter((row) => row.marketValue > 0 && row.theme !== 'unknown')
        .sort((a, b) => b.marketValue - a.marketValue)
        .slice(0, 8)
        .map((row) => ({
            label: row.label,
            value: `${row.percentOfPortfolio.toFixed(1)}%`,
            sub: `${usd(row.marketValue)} · ${row.status.replace('_', ' ')}`,
            tone: row.status === 'breached' || row.status === 'watch' ? 'warn' : 'neutral',
            href: `/portfolios/holdings?theme=${row.theme}`,
        }));
}

// --------------------------------------------------------------------- //
// 10. trim_to_target
// --------------------------------------------------------------------- //

/**
 * How much of a ticker to sell to bring it to a share of the portfolio.
 * Without a ticker it's the employer stock the user named (all its
 * tickers together), against their plan's target unless one is asked for.
 */
export function trim_to_target(
    ctx: AskContext,
    args: { symbol?: string; targetPct?: number } = {},
): AskRow[] {
    const employer = employerSymbols(ctx.policy);
    const requested = normalizeTicker(args.symbol);
    const isEmployer = requested ? employer.includes(requested) : employer.length > 0;
    if (!requested && !isEmployer) return [NO_EMPLOYER_ROW];
    const symbols = new Set(isEmployer ? employer : [requested]);
    const name = isEmployer ? employerStockName(employer) : requested;
    const targetPct = typeof args.targetPct === 'number'
        ? args.targetPct
        : isEmployer ? ctx.policy.employerStockPlan.targetAllocationPct : 25;
    const currentValueUsd = ctx.portfolio.holdings
        .filter((holding) => symbols.has(normalizeTicker(holding.symbol)))
        .reduce((sum, holding) => sum + holding.marketValue, 0);
    if (currentValueUsd <= 0) return [];
    const result = computeTrimAmountToTarget({
        currentValueUsd,
        portfolioValue: policyPortfolioValue(ctx.portfolio),
        targetAllocationPct: targetPct,
    });

    return [
        {
            label: `${name} trim required`,
            value: usd(result.sellUsd),
            sub: `${result.currentAllocationPct.toFixed(1)}% now · target ${targetPct}%`,
            tone: result.sellUsd > 0 ? 'warn' : 'neutral',
            href: isEmployer ? '/settings#employer-stock' : '/portfolios/holdings',
        },
        {
            label: `${name} target value`,
            value: usd(result.targetValueUsd),
            sub: `${result.breachPct.toFixed(1)} percentage points over target`,
            tone: result.breachPct > 0 ? 'warn' : 'neutral',
            href: '/portfolios/holdings',
        },
    ];
}

// --------------------------------------------------------------------- //
// 11. missing_theses
// --------------------------------------------------------------------- //

export function missing_theses(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    const covered = new Set(
        ctx.portfolio.theses
            .filter((thesis) => thesis.status !== 'archived')
            .map((thesis) => normalizeTicker(thesis.ticker)),
    );
    return positions(ctx)
        .filter((p) => !covered.has(p.symbol))
        .sort((a, b) => b.marketValue - a.marketValue)
        .slice(0, 10)
        .map((p) => ({
            label: p.symbol,
            value: usd(p.marketValue),
            sub: `${p.name} · no active written thesis found`,
            tone: 'warn',
            href: '/research',
        }));
}

// --------------------------------------------------------------------- //
// 12. cash_jobs
// --------------------------------------------------------------------- //

export function cash_jobs(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    const summary = computeCashPolicySummary({
        totalCash: ctx.portfolio.cashTotal,
        jobs: [...ctx.policy.cashJobs],
        deploymentRule: ctx.policy.cashDeploymentRule,
        asOf: new Date(ctx.now),
    });

    return [
        {
            label: 'Unassigned cash',
            value: usd(summary.unassignedCash),
            sub: `${Math.round(summary.assignedPct)}% assigned · ${summary.status.replace('_', ' ')}`,
            tone: summary.unassignedCash > 0 ? 'warn' : 'neutral',
            href: '/settings',
        },
        {
            label: 'Reserved cash',
            value: usd(summary.reservedCash),
            sub: `${summary.jobs.length} cash jobs configured`,
            tone: 'neutral',
            href: '/settings',
        },
        {
            label: 'Next deployment',
            value: usd(summary.nextDeploymentAmount),
            sub: summary.nextDueDate ?? 'No due date set',
            tone: summary.deploymentDue ? 'warn' : 'neutral',
            href: '/settings',
        },
    ];
}

// --------------------------------------------------------------------- //
// 13. churn_risks
// --------------------------------------------------------------------- //

export function churn_risks(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    const analysis = computeChurnAnalysis(ctx.portfolio.trades, {
        asOf: new Date(ctx.now),
        windowDays: ctx.policy.churnPolicy.windowDays,
        watchRepeatSymbols: ctx.policy.churnPolicy.watchRepeatSymbols,
        breachRepeatSymbols: ctx.policy.churnPolicy.breachRepeatSymbols,
    });

    return analysis.rows.slice(0, 8).map((row) => ({
        label: row.symbol,
        value: `${row.churnScore}/100`,
        sub: `${row.tradeCount} trades · ${usd(row.turnoverUsd)} turnover · ${row.recommendation}`,
        tone: row.status === 'breached' || row.status === 'watch' ? 'warn' : 'neutral',
        href: '/portfolios/activity',
    }));
}

// --------------------------------------------------------------------- //
// 14. trade_policy_impact
// --------------------------------------------------------------------- //

/** Recent buys of names a breached or watched policy check points at. */
export function trade_policy_impact(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    if (ctx.portfolio.holdings.length === 0) return [];
    const dashboard = evaluateRiskPolicy(ctx.portfolio, ctx.policy, { asOf: new Date(ctx.now) });
    const flagged = new Set(
        dashboard.dimensions
            .filter((dimension) => dimension.status === 'breached' || dimension.status === 'watch')
            .flatMap((dimension) => dimension.impactedSymbols.map(normalizeTicker)),
    );

    return ctx.activity
        .filter((row) => row.side === 'BUY' && row.symbol && flagged.has(row.symbol))
        .slice(0, 8)
        .map((row) => ({
            label: `BUY ${row.symbol}`,
            value: usd(row.value),
            sub: `${new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · added to a name a breached or watched policy check points at`,
            tone: 'warn',
            href: '/execution',
        }));
}

function statusRank(status: string): number {
    if (status === 'breached') return 3;
    if (status === 'missing_data') return 2;
    if (status === 'watch') return 1;
    return 0;
}

// --------------------------------------------------------------------- //
// Dispatch table
// --------------------------------------------------------------------- //

export const TOOLS: Record<
    AskToolName,
    (ctx: AskContext, args: Record<string, unknown>) => AskRow[]
> = {
    top_alpha_contributors: (ctx, args) => top_alpha_contributors(ctx, args),
    pnl_attribution: (ctx, args) => pnl_attribution(ctx, args),
    sector_exposure: (ctx, args) => sector_exposure(ctx, args),
    trades_matching: (ctx, args) => trades_matching(ctx, args),
    correlation_with: (ctx, args) => correlation_with(ctx, args),
    alpha_radar_evidence_search: (ctx, args) => alpha_radar_evidence_search(ctx, args),
    policy_breaches: (ctx, args) => policy_breaches(ctx, args),
    stress_test: (ctx, args) => stress_test(ctx, args),
    theme_exposure: (ctx, args) => theme_exposure(ctx, args),
    trim_to_target: (ctx, args) => trim_to_target(ctx, args),
    missing_theses: (ctx, args) => missing_theses(ctx, args),
    cash_jobs: (ctx, args) => cash_jobs(ctx, args),
    churn_risks: (ctx, args) => churn_risks(ctx, args),
    trade_policy_impact: (ctx, args) => trade_policy_impact(ctx, args),
};

/** Runs a tool and wraps the return in a recorded `AskToolRun`. */
export function runTool(
    name: AskToolName,
    args: Record<string, unknown>,
    ctx: AskContext,
): AskToolRun {
    const fn = TOOLS[name];
    const rows = fn(ctx, args);
    // Compute a headline — first row's value, or a summed total when
    // that makes sense.
    let headline: string | undefined;
    if (name === 'pnl_attribution') {
        // "-$1,200" parses to -1200 once the "$" and "," go.
        const total = rows.reduce((s, r) => {
            const n = parseFloat(r.value.replace(/[+$,]/g, ''));
            return s + (Number.isFinite(n) ? n : 0);
        }, 0);
        headline = usdSigned(total);
    } else if (rows.length > 0) {
        headline = rows[0].value;
    }
    return { name, args, rows, headline };
}
