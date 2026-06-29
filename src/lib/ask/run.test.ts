import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildDefaultContext, runAsk } from './run';
import { plan } from './planner';

describe('Ask Ledger Alpha Radar memory integration', () => {
    test('plans Alpha Radar evidence questions to the semantic memory tool', () => {
        const planned = plan('What Alpha Radar evidence mentions Berkshire 13F AI infrastructure themes?');

        assert.strictEqual(planned.intent, 'alpha_radar_memory');
        assert.strictEqual(planned.calls[0].name, 'alpha_radar_evidence_search');
    });

    test('answers Alpha Radar evidence questions with cited semantic memory rows', () => {
        const answer = runAsk(
            'Find Alpha Radar evidence for Berkshire 2025 Q4 AI infrastructure',
            buildDefaultContext(Date.UTC(2026, 4, 13)),
        );

        assert.match(answer.text, /Alpha Radar evidence memory/);
        assert.ok(answer.toolRuns.some((run) => run.name === 'alpha_radar_evidence_search'));
        assert.ok(answer.citations.some((citation) => citation.href.includes('/research?tab=alpha-radar')));
        assert.match(answer.toolRuns[0].rows[0].sub ?? '', /AI infrastructure|Apple|Nvidia/i);
    });
});

describe('Ask Ledger Risk Policy Engine integration', () => {
    test('plans risk-policy questions to the right deterministic tools', () => {
        const cases = [
            ['What happens if GOOG drops 40%?', 'stress_test', 'stress_test'],
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

            assert.strictEqual(planned.intent, intent);
            assert.strictEqual(planned.calls[0].name, toolName);
        }
    });

    test('answers GOOG drawdown questions with stress-test evidence and citations', () => {
        const answer = runAsk(
            'What happens if GOOG drops 40%?',
            buildDefaultContext(Date.UTC(2026, 4, 13)),
        );

        assert.match(answer.text, /deterministic scenario/i);
        assert.match(answer.text, /GOOG -40%/);
        assert.ok(answer.toolRuns.some((run) => run.name === 'stress_test'));
        assert.ok(answer.citations.some((citation) => citation.href.includes('/settings')));
    });

    test('answers missing-thesis questions with research citations', () => {
        const answer = runAsk(
            'Which positions have no written thesis?',
            buildDefaultContext(Date.UTC(2026, 4, 13)),
        );

        assert.match(answer.text, /active written thesis/i);
        assert.ok(answer.toolRuns.some((run) => run.name === 'missing_theses'));
        assert.ok(answer.toolRuns[0].rows.some((row) => row.label === 'AAPL'));
        assert.ok(answer.citations.some((citation) => citation.href.includes('/research')));
    });
});
