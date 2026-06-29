/**
 * AR-114 — deterministic narrative generator.
 *
 * Turns a `ReviewStats` bundle into a 2–3 sentence plain-English
 * paragraph. Pure and deterministic — the same inputs always produce
 * the same string, which is what keeps the weekly-review snapshot
 * stable across reloads and makes the narrative e2e-assertable.
 *
 * The copy is intentionally terse. A working PM reads this at 4pm
 * on a Friday; they don't want marketing prose. An AI polish pass
 * can refine the phrasing in a v2.
 */
import type { ReviewStats } from './types';

function plural(n: number, singular: string, pluralForm?: string): string {
    if (n === 1) return `1 ${singular}`;
    return `${n} ${pluralForm ?? singular + 's'}`;
}

function signedUsd(n: number): string {
    if (n === 0) return '$0';
    const sign = n > 0 ? '+$' : '-$';
    return `${sign}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

function signedPct(n: number): string {
    if (!Number.isFinite(n)) return '0.0%';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
}

export function buildNarrative(stats: ReviewStats): string {
    const {
        tradeCount,
        realizedPnlUsd,
        navPctChange,
        ruleAdherence,
        exceptions,
        policyExceptions,
        sellDisciplineEvents,
        churnWarnings,
        churnSymbols,
        bestDecision,
    } = stats;

    // Sentence 1 — trade volume breakdown.
    let s1: string;
    if (tradeCount.total === 0) {
        s1 = 'This week you sat on your hands — no trades executed.';
    } else {
        const pieces: string[] = [];
        if (tradeCount.buy > 0) pieces.push(plural(tradeCount.buy, 'buy'));
        if (tradeCount.sell > 0) pieces.push(plural(tradeCount.sell, 'sell'));
        if (tradeCount.rebalance > 0) pieces.push(plural(tradeCount.rebalance, 'rebalance'));
        s1 = `This week you executed ${plural(tradeCount.total, 'trade')}${
            pieces.length > 0 ? ` (${pieces.join(', ')})` : ''
        }.`;
    }

    // Sentence 2 — P&L line. Always render so the card always has a number.
    const s2 = tradeCount.total === 0
        ? `No realised P&L to tally.`
        : `Realised P&L of ${signedUsd(realizedPnlUsd)} (${signedPct(navPctChange)} of NAV).`;

    // Sentence 3 — adherence + best decision + exceptions, compressed
    // into a single line. Skip when nothing interesting happened.
    const parts3: string[] = [];
    if (tradeCount.total > 0) {
        parts3.push(`Rule adherence averaged ${Math.round(ruleAdherence)}/100`);
        if (exceptions > 0) {
            parts3.push(
                policyExceptions > 0
                    ? `${plural(exceptions, 'exception')} (${plural(policyExceptions, 'policy exception')})`
                    : `${plural(exceptions, 'exception')}`,
            );
        }
    }
    if (bestDecision) {
        parts3.push(
            `best decision: ${bestDecision.label} at ${signedUsd(bestDecision.impactUsd)}`,
        );
    }
    if (sellDisciplineEvents > 0) {
        parts3.push(plural(sellDisciplineEvents, 'sell-discipline action'));
    }
    if (churnWarnings > 0) {
        const symbols = churnSymbols.length > 0 ? ` (${churnSymbols.slice(0, 3).join(', ')})` : '';
        parts3.push(`${plural(churnWarnings, 'churn warning')}${symbols}`);
    }
    const s3 = parts3.length > 0 ? parts3.join(' · ') + '.' : '';

    return [s1, s2, s3].filter(Boolean).join(' ');
}
