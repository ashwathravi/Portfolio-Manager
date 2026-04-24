/**
 * AR-112 — Pattern generation pipeline.
 *
 * `generatePatterns(entries, opts?)` runs all deterministic detectors,
 * optionally polishes headlines via the Claude artifact API (no-op in
 * Next.js — the try/catch swallows it), ranks by score, caps at the
 * requested limit (default 6), and returns the top slice.
 *
 * Pure-ish: `Date.now()` stamps `generatedAt` once per call; everything
 * else is deterministic. That's the right tradeoff — we want the
 * timestamp to reflect the run, not the fixture.
 */

import type { JournalEntry } from '@/types/trade';
import { runAllDetectors } from './detectors';
import type { DetectorContext, Pattern } from './types';

export interface GenerateOptions {
    /** Approximate NAV in USD used by %-of-NAV thresholds. */
    nav?: number;
    /** Ticker → sector lookup. Required by `sector_drift`. */
    sectorByTicker?: Record<string, string>;
    /** Target sector allocation as fractions (0–1). Missing sectors
     *  default to 0 — any exposure above the 3pp threshold flags. */
    sectorTargets?: Record<string, number>;
    /** Max patterns returned from the ranked list. Default 6 per
     *  AR-112 acceptance. */
    limit?: number;
    /** Override for the `generatedAt` stamp. Lets tests pin a fixed
     *  timestamp so snapshot assertions stay stable. */
    now?: string;
    /** When true, attempts to rewrite headlines via `window.claude.complete`.
     *  Defaults to `false` — the polish pass adds latency and is a
     *  no-op outside Claude artifacts. Set to `true` when the project
     *  runs inside an artifact where that API exists. */
    polish?: boolean;
}

/** Default sector allocation targets — deliberately conservative, so
 *  any concentration shows up. Paired with `SECTOR_BY_TICKER` from
 *  `@/lib/adherence/seed`, which covers the seed journal tickers. */
export const DEFAULT_SECTOR_TARGETS: Record<string, number> = {
    Technology: 0.35,
    'Consumer Discretionary': 0.15,
    Financials: 0.15,
    'Health Care': 0.1,
    'Consumer Staples': 0.1,
    Energy: 0.05,
    'Communication Services': 0.05,
};

/**
 * Default NAV fallback when the caller doesn't hand one in. $250k is
 * the same figure the Focus variant uses for guardrails — keeping them
 * in sync means the "1% of NAV" threshold in `negative_mood_cost` fires
 * at the same dollar amount as the real guardrails.
 */
export const DEFAULT_NAV = 250_000;

export async function generatePatterns(
    entries: ReadonlyArray<JournalEntry>,
    opts: GenerateOptions = {},
): Promise<Pattern[]> {
    const ctx: DetectorContext = {
        now: opts.now ?? new Date().toISOString(),
        nav: opts.nav ?? DEFAULT_NAV,
        sectorByTicker: opts.sectorByTicker ?? {},
        sectorTargets: opts.sectorTargets ?? DEFAULT_SECTOR_TARGETS,
    };

    const raw = runAllDetectors(entries, ctx);
    const polished = opts.polish ? await polishHeadlines(raw) : raw;
    const ranked = [...polished].sort((a, b) => b.score - a.score);
    return ranked.slice(0, opts.limit ?? 6);
}

// --------------------------------------------------------------------- //
// Optional AI polish pass
// --------------------------------------------------------------------- //

/**
 * Rewrites headlines through `window.claude.complete` when available.
 * The prompt explicitly forbids changing the numbers — the AI's job is
 * purely copywriting polish. On any error (no window.claude, JSON
 * parse failure, timeout) we fall back to the raw headlines.
 *
 * Kept in this file even though it's never called from the Next.js app
 * so a future Claude-artifact port can flip the `polish` flag and get
 * the pass for free.
 */
async function polishHeadlines(patterns: Pattern[]): Promise<Pattern[]> {
    try {
        const maybeClaude = (globalThis as {
            claude?: { complete?: (prompt: string) => Promise<string> };
        }).claude;
        if (!maybeClaude?.complete) return patterns;
        const prompt = `Rewrite these trading-journal observations to be punchy and under 14 words each.
Keep the numbers EXACT. Use <em>…</em> around the key metric. Return a JSON array of { id, text }.

${JSON.stringify(patterns.map((p) => ({ id: p.id, text: p.headline })))}`;
        const raw = await maybeClaude.complete(prompt);
        const parsed = JSON.parse(raw) as ReadonlyArray<{ id: string; text: string }>;
        const byId = new Map(parsed.map((p) => [p.id, p.text]));
        return patterns.map((p) => ({
            ...p,
            headline: byId.get(p.id) ?? p.headline,
        }));
    } catch {
        return patterns;
    }
}
