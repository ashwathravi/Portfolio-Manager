import { describe, test } from 'node:test';
import assert from 'node:assert';

import { ALPHA_RADAR_DEMO_MEMORY_CHUNKS } from '@/lib/alpha-radar/demo-memory';
import type { ActivityRow } from '@/lib/portfolio/activity';
import { closedTrades } from '@/lib/portfolio/closed-trades';
import type { StoredClose } from '@/lib/portfolio/valuation-snapshots';
import type { PolicyPortfolioHolding, RiskPolicySettings } from '@/lib/risk-policy';
import { storedRiskPolicy } from '@/lib/settings/risk-policy';

import { plan } from './planner';
import { runAsk } from './run';
import type { AskContext } from './tools';

const NOW = Date.UTC(2026, 9, 26, 16);
const DEFAULT_POLICY = storedRiskPolicy({ status: 'unavailable' });

function holding(id: string, symbol: string, quantity: number, avgCost: number, price: number, defaultBucket: PolicyPortfolioHolding['defaultBucket'] = 'active'): PolicyPortfolioHolding {
    return { id, symbol, name: `${symbol} Inc.`, quantity, avgCost, currentPrice: price, marketValue: quantity * price, defaultBucket };
}

function row(id: string, date: string, side: ActivityRow['side'], symbol: string, quantity: number, price: number): ActivityRow {
    return { id, date: `${date}T15:00:00.000Z`, symbol, side, quantity, price, value: quantity * price, account: 'Brokerage', notes: null, fees: null, currency: 'USD' };
}

/** `count` weekday closes ending on 2026-10-23, moving as `move(i)`. */
function closes(count: number, move: (i: number) => number, start = 100): StoredClose[] {
    const out: StoredClose[] = [];
    const at = new Date(Date.UTC(2026, 9, 23));
    while (out.length < count) {
        if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) out.unshift({ date: at.toISOString().slice(0, 10), close: 0 });
        at.setUTCDate(at.getUTCDate() - 1);
    }
    let level = start;
    return out.map((close, i) => {
        if (i > 0) level *= 1 + move(i);
        return { ...close, close: level };
    });
}

const wiggle = (i: number) => 0.01 * Math.sin(i * 1.3) + 0.004 * Math.cos(i * 0.7);

function context(overrides: Partial<AskContext> = {}, policy: Partial<RiskPolicySettings> = {}): AskContext {
    // Newest first, as the server reads them.
    const activity = [
        row('t5', '2026-10-22', 'BUY', 'TSLA', 10, 250),
        row('t4', '2026-10-21', 'SELL', 'PG', 50, 150),
        row('t2', '2026-10-20', 'SELL', 'KO', 100, 66),
        row('t3', '2026-09-02', 'BUY', 'PG', 50, 160),
        row('t1', '2026-09-01', 'BUY', 'KO', 100, 60),
    ];
    return {
        portfolio: {
            holdings: [
                holding('h1', 'NVDA', 100, 100, 180),
                holding('h2', 'MSFT', 50, 420, 400),
                holding('h3', 'TSLA', 40, 300, 250, 'speculative'),
                holding('h4', 'VTI', 100, 200, 250, 'core'),
                // MSFT in a second account: one position.
                { ...holding('h5', 'MSFT', 10, 380, 400), id: 'h5' },
            ],
            cashTotal: 10_000,
            trades: activity.map((r) => ({ id: r.id, date: r.date, type: r.side.toLowerCase(), ticker: r.symbol, amount: r.value })),
            theses: [{ id: 'u1', ticker: 'NVDA', status: 'active' }, { id: 'u2', ticker: 'TSLA', status: 'archived' }],
        },
        activity,
        closedTrades: closedTrades(activity),
        policy: { ...DEFAULT_POLICY, ...policy },
        sectors: { NVDA: 'Tech', MSFT: 'Tech', TSLA: 'Auto', VTI: 'Funds', KO: 'Consumer', PG: 'Consumer' },
        now: NOW,
        ...overrides,
    };
}

const employer = (symbols: string[]): Partial<RiskPolicySettings> => ({
    employerStockPlan: { ...DEFAULT_POLICY.employerStockPlan, symbols },
});

describe('Ask Ledger planner', () => {
    test('routes risk-policy questions to the right deterministic tools', () => {
        const cases = [
            ['What happens if my employer stock drops 40%?', 'stress_test', 'stress_test'],
            ['How much AI exposure do I have?', 'theme_policy_exposure', 'theme_exposure'],
            ['How much GOOGL do I need to trim to reach a 25% target?', 'trim_to_target', 'trim_to_target'],
            ['Which positions have no written thesis?', 'missing_thesis', 'missing_theses'],
            ['How much cash is unassigned to jobs?', 'cash_jobs', 'cash_jobs'],
            ['Where am I repeatedly trading the same names?', 'churn_risks', 'churn_risks'],
            ['Which trades increased policy risk?', 'trade_policy_impact', 'trade_policy_impact'],
            ['Which risk policy guardrails are breached?', 'policy_breaches', 'policy_breaches'],
        ] as const;
        for (const [question, intent, toolName] of cases) {
            const planned = plan(question);
            assert.strictEqual(planned.intent, intent, question);
            assert.strictEqual(planned.calls[0].name, toolName, question);
        }
    });

    test('regression: no ticker is assumed; "AI" is not one', () => {
        assert.deepStrictEqual(plan('What happens if my employer stock drops?').calls[0].args, { scenarioId: 'employer_40_down' });
        assert.deepStrictEqual(plan('What happens if NVDA drops 40%?').calls[0].args, { scenarioId: 'broad_market_20_tech_beta', symbol: 'NVDA' });
        assert.deepStrictEqual(plan('What if AI drops?').calls[0].args, { scenarioId: 'ai_basket_30_down' });
        assert.deepStrictEqual(plan('How much should I trim to reach my target allocation?').calls[0].args, { symbol: undefined, targetPct: undefined });
        assert.deepStrictEqual(plan('Trim GOOGL to a 10% target').calls[0].args, { symbol: 'GOOGL', targetPct: 10 });
    });
});

describe('Ask Ledger answers from the user\'s data', () => {
    test('regression: an empty portfolio is an empty answer, never example data', () => {
        const empty = context({ portfolio: { holdings: [], cashTotal: 0, trades: [], theses: [] }, activity: [], closedTrades: [] });
        for (const question of ['Am I overexposed to AI?', 'Which holdings have hurt my alpha this year?', 'Which risk policy guardrails are breached?']) {
            const answer = runAsk(question, empty);
            assert.match(answer.text, /no holdings to answer from yet/, question);
            assert.deepStrictEqual(answer.citations, []);
        }
        assert.match(runAsk("Where did last month's P&L come from?", empty).text, /No closed trades in that window/);
    });

    test('sector exposure from the securities master, one position per ticker', () => {
        const answer = runAsk('Am I overexposed to AI?', context());
        const rows = answer.toolRuns[0].rows;
        // NVDA $18,000 + MSFT $24,000 of $77,000 in holdings.
        assert.deepStrictEqual(rows.map((r) => [r.label, r.value]), [['Tech', '54.5%'], ['Funds', '32.5%'], ['Auto', '13.0%']]);
        assert.match(answer.text, /led by \*\*Tech\*\* at 54\.5%/);
    });

    test('drags and contributors by unrealized gain, across accounts', () => {
        const hurt = runAsk('Which holdings have hurt my alpha this year?', context());
        assert.deepStrictEqual(hurt.toolRuns[0].rows.map((r) => [r.label, r.value]).slice(0, 2), [['TSLA', '-$2,000'], ['MSFT', '-$800']]);
        assert.match(hurt.text, /biggest drags right now, by unrealized gain or loss/);
        const helped = runAsk('What are my best performing holdings?', context());
        assert.deepStrictEqual(helped.toolRuns[0].rows.map((r) => r.label), ['NVDA', 'VTI']);
    });

    test('regression: realized P&L from closed trades, a net loss signed as one', () => {
        const answer = runAsk("Where did last month's P&L come from?", context());
        // KO +$600, PG -$500, both Consumer: +$100.
        assert.deepStrictEqual(answer.toolRuns[0].rows.map((r) => [r.label, r.value]), [['Consumer', '+$100']]);
        const byTicker = runAsk('Where did my P&L come from by ticker this month?', context());
        assert.deepStrictEqual(byTicker.toolRuns[0].rows.map((r) => r.value), ['+$600', '-$500']);
        assert.strictEqual(byTicker.toolRuns[0].headline, '+$100');
        const lossOnly = context({ closedTrades: closedTrades([row('a', '2026-10-01', 'BUY', 'PG', 10, 160), row('b', '2026-10-20', 'SELL', 'PG', 10, 150)]) });
        assert.strictEqual(runAsk("Where did last month's P&L come from?", lossOnly).toolRuns[0].headline, '-$100');
        assert.match(answer.text, /Realized P&L over the last 30 days nets \+\$100/);
    });

    test('winning and losing trades are the closed ones', () => {
        assert.deepStrictEqual(runAsk('Show my winning trades this month', context()).toolRuns[0].rows.map((r) => [r.label, r.value]), [['Sold 100 KO', '+$600']]);
        assert.deepStrictEqual(runAsk('Show my losing trades this month', context()).toolRuns[0].rows.map((r) => [r.label, r.value]), [['Sold 50 PG', '-$500']]);
    });

    test('correlation from stored closes; not enough history is said', () => {
        const withCloses = context({
            closes: new Map([
                ['SPY', closes(60, wiggle)],
                ['NVDA', closes(60, (i) => 2 * wiggle(i))],
                ['MSFT', closes(60, (i) => -wiggle(i))],
                ['TSLA', closes(10, wiggle)],
            ]),
        });
        const answer = runAsk('How do my holdings correlate with SPY?', withCloses);
        assert.deepStrictEqual(answer.toolRuns[0].rows.map((r) => [r.label, r.value]), [['NVDA', '1.00'], ['MSFT', '-1.00']]);
        assert.match(answer.toolRuns[0].rows[0].sub ?? '', /^59 sessions/);
        assert.match(answer.text, /moved with \*\*SPY\*\*/);
        assert.match(runAsk('How do my holdings correlate with SPY?', context()).text, /aren't enough stored daily closes for SPY/);
    });

    test('policy breaches follow the user\'s own caps', () => {
        const breaches = (policy: Partial<RiskPolicySettings>) => runAsk('Which risk policy guardrails are breached?', context({}, policy)).toolRuns[0].rows.map((r) => r.label);
        // TSLA is 11.5% of $87,000 (cash included) against the speculative bucket's 5% cap.
        assert.ok(breaches({}).includes('Speculative/options'));
        const relaxed = DEFAULT_POLICY.bucketPolicies.map((p) => (p.bucket === 'speculative' ? { ...p, maxPct: 50 } : p));
        assert.ok(!breaches({ bucketPolicies: relaxed }).includes('Speculative/options'));
        assert.ok(!breaches({ bucketAssignments: { TSLA: 'core' } }).includes('Speculative/options'));
    });

    test('stress tests: the employer named, a ticker, or none named', () => {
        const none = runAsk('What happens if my employer stock drops?', context());
        assert.match(none.text, /haven't named your employer's stock/);
        assert.strictEqual(none.citations[0].href, '/settings#employer-stock');

        const named = runAsk('What happens if my employer stock drops?', context({}, employer(['MSFT'])));
        assert.match(named.text, /\*\*MSFT -40%\*\*: -\$9,600/);

        const ticker = runAsk('What happens if NVDA drops 40%?', context());
        assert.match(ticker.text, /\*\*NVDA -40%\*\*: -\$7,200/);
        assert.ok(ticker.citations.some((citation) => citation.href.includes('/portfolios/holdings')));
    });

    test('trim to target: the employer stock against its plan, or the ticker asked about', () => {
        const plan = runAsk('How much should I trim to reach my target allocation?', context({}, employer(['MSFT'])));
        // MSFT $24,000 of $87,000 against the plan's 20%: sell $6,600.
        assert.deepStrictEqual(plan.toolRuns[0].rows.map((r) => [r.label, r.value]), [['MSFT trim required', '$6,600'], ['MSFT target value', '$17,400']]);
        const ticker = runAsk('Trim NVDA to a 10% target', context());
        assert.strictEqual(ticker.toolRuns[0].rows[0].value, '$9,300');
        assert.match(runAsk('How much should I trim to reach my target allocation?', context()).text, /haven't named your employer's stock/);
    });

    test('missing theses: holdings without an active thesis of the user\'s', () => {
        const answer = runAsk('Which positions have no written thesis?', context());
        // NVDA has one; TSLA's is archived.
        assert.deepStrictEqual(answer.toolRuns[0].rows.map((r) => r.label), ['VTI', 'MSFT', 'TSLA']);
    });

    test('cash jobs, churn and trade impact from the user\'s policy and trades', () => {
        assert.strictEqual(runAsk('How much cash is unassigned to jobs?', context()).toolRuns[0].rows[0].value, '$10,000');
        const assigned = context({}, { cashJobs: [{ id: 'cash-tax_reserve', type: 'tax_reserve', label: 'Tax reserve', amount: 10_000 }] });
        assert.strictEqual(runAsk('How much cash is unassigned to jobs?', assigned).toolRuns[0].rows[0].value, '$0');
        // TSLA was bought into a breached speculative bucket; KO and PG are names traded back and forth.
        assert.deepStrictEqual(
            runAsk('Which trades increased policy risk?', context()).toolRuns[0].rows.map((r) => [r.label, r.value]),
            [['BUY TSLA', '$2,500'], ['BUY PG', '$8,000'], ['BUY KO', '$6,000']],
        );
    });

    test('Alpha Radar evidence from the stored memory the server loaded', () => {
        const question = 'Find Alpha Radar evidence for Berkshire 2025 Q4 AI infrastructure';
        assert.strictEqual(plan(question).calls[0].name, 'alpha_radar_evidence_search');
        const answer = runAsk(question, context({ alphaRadarMemory: ALPHA_RADAR_DEMO_MEMORY_CHUNKS }));
        assert.match(answer.text, /Alpha Radar evidence memory/);
        assert.ok(answer.citations.some((citation) => citation.href.includes('/research?tab=alpha-radar')));
        assert.match(runAsk(question, context()).text, /didn't find any matching data/);
    });
});

describe('Ask Ledger citation links', () => {
    test('regression: every citation and row link points at a live destination', async () => {
        const { activeDestination } = await import('@/lib/navigation');
        const questions = [
            "What's my Sharpe by sector?",
            'Am I overexposed to AI?',
            "Where did last month's P&L come from?",
            'Which holdings have hurt my alpha this year?',
            'Where am I repeatedly trading the same names?',
            'Show my winning trades',
            'What happens if NVDA drops 40%?',
            'What happens if my employer stock drops?',
            'How much should I trim to reach my target allocation?',
            'Which positions have no written thesis?',
            'How much cash is unassigned to jobs?',
            'Which trades increased policy risk?',
            'Which risk policy guardrails are breached?',
            'How much AI exposure do I have?',
        ];
        for (const ctx of [context(), context({}, employer(['MSFT']))]) {
            for (const q of questions) {
                const answer = runAsk(q, ctx);
                const hrefs = [
                    ...answer.citations.map((c) => c.href),
                    ...answer.toolRuns.flatMap((r) => r.rows.map((row) => row.href).filter((h): h is string => Boolean(h))),
                ];
                for (const href of hrefs) {
                    const path = href.split(/[?#]/)[0];
                    assert.ok(activeDestination(path), `"${q}" links to dead route ${href}`);
                }
            }
        }
    });
});
