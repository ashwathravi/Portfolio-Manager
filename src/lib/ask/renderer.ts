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
    const defaultHrefByTool: Partial<Record<AskToolRun['name'], string>> = {
        sector_exposure: '/portfolios/holdings',
        trades_matching: '/trade-log',
        policy_breaches: '/',
        stress_test: '/',
        theme_exposure: '/portfolios/holdings',
        trim_to_target: '/settings',
        missing_theses: '/research',
        cash_jobs: '/settings',
        churn_risks: '/portfolios/trade-log',
        trade_policy_impact: '/execution',
    };
    const href = row?.href ?? defaultHrefByTool[run.name] ?? '/performance';
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
        case 'alpha_radar_memory':
            return `I searched Alpha Radar evidence memory and found **${run.rows[0].label}**[[tool:${run.name}#0]]. Closest matches:`;
        case 'policy_breaches':
            return `Current policy breaches are led by **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]]. Review list:`;
        case 'stress_test':
            return `I ran the deterministic scenario **${run.rows[0].label}**: ${run.rows[0].value}[[tool:${run.name}#0]] portfolio impact. Main drivers:`;
        case 'theme_policy_exposure':
            return `Theme exposure is led by **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]] of portfolio value. Full view:`;
        case 'trim_to_target':
            return `To reach the requested target, the first trim estimate is **${run.rows[0].value}**[[tool:${run.name}#0]]. Details:`;
        case 'missing_thesis':
            return `These positions do not have an active written thesis attached. Largest gap: **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]].`;
        case 'cash_jobs':
            return `Cash job coverage shows **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]]. Breakdown:`;
        case 'churn_risks':
            return `Churn risk is led by **${run.rows[0].label}** with a ${run.rows[0].value} score[[tool:${run.name}#0]]. Names to review:`;
        case 'trade_policy_impact':
            return `Recent trades that added to watch or breached policy dimensions start with **${run.rows[0].label}** at ${run.rows[0].value}[[tool:${run.name}#0]].`;
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
