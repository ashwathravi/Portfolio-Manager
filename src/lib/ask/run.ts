/**
 * AR-115 — Ask Ledger orchestrator.
 *
 * Wires the planner → tool executor → renderer. The server answers every
 * question (./server/answer.ts): it plans, loads the user's own data the
 * tools need into an `AskContext`, then runs this. In v2 the planner gets
 * replaced with an LLM call that returns the same `PlannerResult` shape —
 * nothing else in this file changes.
 *
 * The function is synchronous: every tool runs in memory over the
 * context, so awaiting would only add jitter.
 */
import { plan as planQuestion, type PlannerResult } from './planner';
import { renderAnswer } from './renderer';
import { runTool, type AskContext } from './tools';
import type { AskAnswer } from './types';

/** Run an already planned question over `ctx`. */
export function answerPlanned(planned: PlannerResult, ctx: AskContext): AskAnswer {
    const runs = planned.calls.map((call) => runTool(call.name, call.args, ctx));
    return renderAnswer(planned, runs);
}

/**
 * Plan, execute, and render an answer to a natural-language question.
 *
 * The result is a complete assistant turn — Markdown text with
 * citation markers, resolved `citations[]`, and the underlying
 * `toolRuns[]` so the UI can render kv pills without re-running tools.
 */
export function runAsk(question: string, ctx: AskContext): AskAnswer {
    return answerPlanned(planQuestion(question), ctx);
}
