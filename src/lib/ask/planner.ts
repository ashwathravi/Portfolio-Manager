/**
 * AR-115 — Ask Ledger question planner.
 *
 * v1 is a pure rule-based planner: we match the question against a set
 * of keyword patterns, pick the smallest set of tools that can answer,
 * and return the tool-call list for the runner. v2 swaps this file for
 * a `window.claude.complete` planning call — the rest of the stack
 * (tools, renderer, storage) doesn't need to change.
 *
 * The intent here isn't to ace NLP. It's to give a credible, demo-able
 * experience that covers the suggested-prompt scenarios from the spec
 * and degrades gracefully on unrecognised questions.
 */
import type { AskToolName } from './types';

export interface PlannedCall {
    name: AskToolName;
    args: Record<string, unknown>;
}

export interface PlannerResult {
    calls: PlannedCall[];
    /** A one-line "intent" string used by the renderer to tailor copy. */
    intent:
        | 'alpha_hurt'
        | 'alpha_helped'
        | 'pnl_sector'
        | 'pnl_source'
        | 'exposure'
        | 'trades_win'
        | 'trades_loss'
        | 'correlation'
        | 'unknown';
}

/** Normalise for matching — lowercase, collapse common portfolio
 *  shorthands so punctuation doesn't eat the keyword, then strip the
 *  rest of the punctuation. */
function norm(s: string): string {
    return s
        .toLowerCase()
        // Collapse "P&L", "p & l", "p/l", "pnl" variants to a single
        // canonical form BEFORE punctuation stripping. Otherwise the
        // `&` becomes a space and "p l" slips past the `\bpnl\b` rule.
        .replace(/\bp\s*[&/]\s*l\b/g, 'pnl')
        .replace(/\bp\s*n\s*l\b/g, 'pnl')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Extract a likely ticker symbol from the question. Looks for a
 *  2-5-letter uppercase token (e.g. "MSFT", "BRK") in the original
 *  text before normalisation. */
function extractSymbol(q: string): string | undefined {
    const m = q.match(/\b[A-Z]{2,5}\b/);
    return m ? m[0] : undefined;
}

function extractRangeDays(q: string): number {
    const lower = q.toLowerCase();
    if (/\b(year|ytd|this year)\b/.test(lower)) return 365;
    if (/\b(quarter|3 ?months?|90 days?)\b/.test(lower)) return 90;
    if (/\b(month|30 days?)\b/.test(lower)) return 30;
    if (/\b(week|7 days?)\b/.test(lower)) return 7;
    return 30; // default window
}

export function plan(question: string): PlannerResult {
    const q = norm(question);

    // --- Alpha / hurt-helped holdings --------------------------------
    // "which holdings have hurt my alpha this year?"
    if (/\b(hurt|drag|lost|losing|worst)\b/.test(q) && /\b(holding|alpha|return|perform)/.test(q)) {
        return {
            calls: [
                {
                    name: 'top_alpha_contributors',
                    args: { topN: 5, direction: 'negative' },
                },
            ],
            intent: 'alpha_hurt',
        };
    }
    if (/\b(help|helped|best|top|winners|winning)\b/.test(q) && /\b(holding|alpha|return|perform)/.test(q)) {
        return {
            calls: [
                {
                    name: 'top_alpha_contributors',
                    args: { topN: 5, direction: 'positive' },
                },
            ],
            intent: 'alpha_helped',
        };
    }

    // --- P&L source --------------------------------------------------
    // "where did last month's P&L come from?"  —  norm() canonicalises
    // "P&L" → "pnl" so the simple `\bpnl\b` works for every variant.
    if (/\bpnl\b|\bprofit\b|\bgain\b|\bloss\b|\battribution\b/.test(q) &&
        /\bcome from\b|\bsource\b|\bby sector\b|\battribution\b|\bbreakdown\b/.test(q)) {
        return {
            calls: [
                {
                    name: 'pnl_attribution',
                    args: {
                        rangeDays: extractRangeDays(q),
                        groupBy: q.includes('ticker') ? 'ticker' : 'sector',
                    },
                },
            ],
            intent: 'pnl_source',
        };
    }

    // --- Sector exposure / concentration -----------------------------
    if (/\b(exposure|exposed|overexposed|concentration|concentrated|allocat|weight)/.test(q) ||
        /\bai\b/.test(q)) {
        return {
            calls: [{ name: 'sector_exposure', args: {} }],
            intent: 'exposure',
        };
    }

    // --- Trade filter: wins / losses ---------------------------------
    if (/\b(wins?|winners?|profit|good trades?)\b/.test(q) && /\btrade/.test(q)) {
        return {
            calls: [
                {
                    name: 'trades_matching',
                    args: { outcome: 'win', rangeDays: extractRangeDays(q) },
                },
            ],
            intent: 'trades_win',
        };
    }
    if (/\b(loss|losses|losers?|bad trades?)\b/.test(q) && /\btrade/.test(q)) {
        return {
            calls: [
                {
                    name: 'trades_matching',
                    args: { outcome: 'loss', rangeDays: extractRangeDays(q) },
                },
            ],
            intent: 'trades_loss',
        };
    }

    // --- Correlation -------------------------------------------------
    if (/\bcorrelat|move with|track with\b/.test(q)) {
        return {
            calls: [
                {
                    name: 'correlation_with',
                    args: { symbol: extractSymbol(question) ?? 'SPY' },
                },
            ],
            intent: 'correlation',
        };
    }

    // --- Sharpe / risk asked as a "by" query ------------------------
    if (/\bsharpe\b/.test(q) && /\bsector|strateg/.test(q)) {
        return {
            calls: [{ name: 'sector_exposure', args: {} }],
            intent: 'exposure',
        };
    }

    // --- Sector-group P&L ("p&l by sector") --------------------------
    if (/\bby sector\b/.test(q)) {
        return {
            calls: [
                {
                    name: 'pnl_attribution',
                    args: { rangeDays: extractRangeDays(q), groupBy: 'sector' },
                },
            ],
            intent: 'pnl_sector',
        };
    }

    // --- Fallback: show exposure so we always return *something* ----
    return {
        calls: [{ name: 'sector_exposure', args: {} }],
        intent: 'unknown',
    };
}
