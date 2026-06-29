/**
 * AR-115 — Ask Ledger orchestrator.
 *
 * Single entry point used by both the ⌘K sheet and the `/ask` page.
 * Wires the planner → tool executor → renderer. In v2 the planner
 * gets replaced with a `window.claude.complete` call that returns the
 * same `PlannerResult` shape — nothing else in this file changes.
 *
 * The function is intentionally synchronous: all tools run in-memory
 * against the seed journal + mock portfolios, so awaiting just adds
 * jitter. If the UI wants a "typing" animation it should stagger
 * rendering in the component layer, not here.
 */
import { SEED_JOURNAL } from '@/lib/journal/seed';
import { mockPortfolios, mockTransactions } from '@/lib/mockData';
import { ALPHA_RADAR_DEMO_MEMORY_CHUNKS } from '@/lib/alpha-radar/demo-memory';
import { DEFAULT_THESES } from '@/lib/research/thesis';
import { plan } from './planner';
import { renderAnswer } from './renderer';
import { runTool, type AskContext } from './tools';
import type { AskAnswer } from './types';

/** Build the default context from seed data. Callers can override for
 *  tests by passing their own `AskContext` to `runAsk`. */
export function buildDefaultContext(now: number = Date.now()): AskContext {
    const holdings = mockPortfolios.flatMap((p) => p.holdings);
    return {
        portfolios: mockPortfolios,
        holdings,
        transactions: mockTransactions,
        entries: SEED_JOURNAL,
        theses: DEFAULT_THESES,
        alphaRadarMemory: ALPHA_RADAR_DEMO_MEMORY_CHUNKS,
        now,
    };
}

/**
 * Plan, execute, and render an answer to a natural-language question.
 *
 * The result is a complete assistant turn — Markdown text with
 * citation markers, resolved `citations[]`, and the underlying
 * `toolRuns[]` so the UI can render kv pills without re-running tools.
 */
export function runAsk(question: string, ctx: AskContext = buildDefaultContext()): AskAnswer {
    const planned = plan(question);
    const runs = planned.calls.map((call) => runTool(call.name, call.args, ctx));
    return renderAnswer(planned, runs);
}
