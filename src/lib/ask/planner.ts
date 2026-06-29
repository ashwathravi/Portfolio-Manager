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
        | 'alpha_radar_memory'
        | 'policy_breaches'
        | 'stress_test'
        | 'theme_policy_exposure'
        | 'trim_to_target'
        | 'missing_thesis'
        | 'cash_jobs'
        | 'churn_risks'
        | 'trade_policy_impact'
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

function extractPercent(q: string): number | undefined {
    const match = q.match(/\b(\d+(?:\.\d+)?)\s*%/);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : undefined;
}

function extractPolicySymbol(q: string): string | undefined {
    return extractSymbol(q) ?? (/\bgoogl?\b/i.test(q) ? 'GOOG' : undefined);
}

export function plan(question: string): PlannerResult {
    const q = norm(question);

    // --- Risk Policy Engine ------------------------------------------
    if (/\bwhat happens if\b|\bstress\b|\bscenario\b|\bdrawdown\b|\bdrops?\b|\bfalls?\b/.test(q)) {
        let scenarioId = 'broad_market_20_tech_beta';
        if (/\bgoogl?\b/.test(q)) scenarioId = 'goog_40_down';
        else if (/\bai\b/.test(q)) scenarioId = 'ai_basket_30_down';
        else if (/\bsemi|semiconductor|chip\b/.test(q)) scenarioId = 'semis_35_down';
        else if (/\bcrypto|risk on|liquidity\b/.test(q)) scenarioId = 'crypto_liquidity_50_down';
        return {
            calls: [{ name: 'stress_test', args: { scenarioId } }],
            intent: 'stress_test',
        };
    }

    if (/\btrim\b|\breduce\b|\bde risk\b|\bderisk\b/.test(q) && /\btarget\b|\ballocation\b|\b%\b/.test(q)) {
        return {
            calls: [{
                name: 'trim_to_target',
                args: {
                    symbol: extractPolicySymbol(question) ?? 'GOOG',
                    targetPct: extractPercent(question) ?? 25,
                },
            }],
            intent: 'trim_to_target',
        };
    }

    if (/\bmissing\b|\bwithout\b|\bno\b/.test(q) && /\bthes(?:is|es)\b/.test(q)) {
        return {
            calls: [{ name: 'missing_theses', args: {} }],
            intent: 'missing_thesis',
        };
    }

    if (/\bcash\b/.test(q) && /\b(unassigned|assigned|job|reserved|deployment|deploy|excess)\b/.test(q)) {
        return {
            calls: [{ name: 'cash_jobs', args: {} }],
            intent: 'cash_jobs',
        };
    }

    if (/\bchurn\b|\brepeated(?:ly)?\b|\bround trip|overtrading|cooldown\b/.test(q)) {
        return {
            calls: [{ name: 'churn_risks', args: {} }],
            intent: 'churn_risks',
        };
    }

    if (/\btrades?\b/.test(q) && /\b(policy|breach|risk|worsen|increased)\b/.test(q)) {
        return {
            calls: [{ name: 'trade_policy_impact', args: {} }],
            intent: 'trade_policy_impact',
        };
    }

    if (/\bpolicy\b|\bbreach|breached|guardrail|above cap|over cap\b/.test(q)) {
        return {
            calls: [{ name: 'policy_breaches', args: {} }],
            intent: 'policy_breaches',
        };
    }

    if (/\btheme\b|\bfactor\b|\bai\b|\bsemi|semiconductor|mega cap|crypto\b/.test(q) &&
        /\b(exposure|exposed|allocation|weight|portfolio|trade)\b/.test(q)) {
        return {
            calls: [{ name: 'theme_exposure', args: {} }],
            intent: 'theme_policy_exposure',
        };
    }

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

    // --- Alpha Radar evidence memory --------------------------------
    if (/\balpha radar\b|\b13f\b|\bfiler\b|\bfiling\b|\bberkshire\b|\btheme\b|\bevidence\b/.test(q)) {
        return {
            calls: [
                {
                    name: 'alpha_radar_evidence_search',
                    args: { query: question, limit: 5 },
                },
            ],
            intent: 'alpha_radar_memory',
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
