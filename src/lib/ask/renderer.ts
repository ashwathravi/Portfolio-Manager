/**
 * AR-115 — answer renderer.
 *
 * Turns a `PlannerResult` + its executed `AskToolRun`s into an assistant
 * message:
 *   - human-readable Markdown lede tailored to the `intent`
 *   - inline `[[tool:name#i]]` citation markers for every number
 *   - a resolved `citations[]` list the UI uses to render jump-links
 *
 * The renderer never invents numbers. If a tool returned zero rows the
 * copy says so ("no matches in the selected window") rather than
 * fabricating a roll-up.
 */
import type {
    AskAnswer,
    AskCitation,
    AskRow,
    AskToolRun,
} from './types';
import type { PlannerResult } from './planner';

function citationFor(run: AskToolRun, index: number): AskCitation {
    const marker = `tool:${run.name}#${index}`;
    const row = run.rows[index];
    // Prefer the row's explicit href, then a sensible default per tool.
    const href =
        row?.href ??
        (run.name === 'sector_exposure'
            ? '/portfolios/holdings'
            : run.name === 'trades_matching'
              ? '/trade-log'
              : '/performance');
    return { marker, label: row?.label ?? run.name, href };
}

function lede(intent: PlannerResult['intent'], run: AskToolRun | undefined): string {
    if (!run || run.rows.length === 0) {
        return `I ran the query but didn't find any matching data in the current window.`;
    }
    const windowCopy = (() => {
        const rd = (run.args as { rangeDays?: number }).rangeDays;
        if (typeof rd !== 'number' || rd === 0) return 'over all time';
        if (rd >= 365) return 'over the last year';
        if (rd >= 90) return 'over the last quarter';
        if (rd >= 30) return 'over the last 30 days';
        return `over the last ${rd} days`;
    })();
    switch (intent) {
        case 'alpha_hurt':
            return `Your biggest alpha drags right now are **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]]. Full list:`;
        case 'alpha_helped':
            return `Your top alpha contributors are led by **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]]. Top five:`;
        case 'pnl_source':
        case 'pnl_sector':
            return `P&L ${windowCopy} nets ${run.headline ?? run.rows[0].value}[[tool:${run.name}#0]], broken down by sector:`;
        case 'exposure':
            return `Current sector exposure is led by **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]] of NAV. Full book:`;
        case 'trades_win':
            return `You closed ${run.rows.length} ${run.rows.length === 1 ? 'winner' : 'winners'} in that window. Most recent:`;
        case 'trades_loss':
            return `You closed ${run.rows.length} ${run.rows.length === 1 ? 'loss' : 'losses'} in that window. Most recent:`;
        case 'correlation':
            return `Correlation neighbours for the requested symbol (stub — live price series lands in v2):`;
        default:
            return `Here's the current sector exposure — a useful baseline when the question is open-ended:`;
    }
}

/** Build a compact Markdown "kv list" for a set of rows. The UI turns
 *  bullets with `•` markers into styled value pills. */
function kvList(rows: AskRow[], run: AskToolRun): string {
    return rows
        .map((row, i) => {
            const marker = `[[tool:${run.name}#${i}]]`;
            const sub = row.sub ? ` _${row.sub}_` : '';
            return `- **${row.label}** — ${row.value}${marker}${sub}`;
        })
        .join('\n');
}

export function renderAnswer(
    plan: PlannerResult,
    runs: AskToolRun[],
): AskAnswer {
    const run = runs[0];
    const ledeText = lede(plan.intent, run);
    const body = run && run.rows.length > 0 ? `\n\n${kvList(run.rows, run)}` : '';
    const text = `${ledeText}${body}`;

    const citations: AskCitation[] = [];
    runs.forEach((r) => {
        r.rows.forEach((_, i) => citations.push(citationFor(r, i)));
    });

    return {
        text,
        citations,
        toolRuns: runs,
    };
}
