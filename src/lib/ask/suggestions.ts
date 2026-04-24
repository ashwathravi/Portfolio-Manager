/**
 * AR-115 — Ask Ledger suggested prompts.
 *
 * These are the default conversation starters rendered as pills under
 * the input when no messages exist yet (and as a "Try asking…" row in
 * the ⌘K sheet). The set is intentionally small and covers the four
 * intents we explicitly tuned the planner for: exposure, P&L
 * attribution, alpha drag, and a cross-metric ("Sharpe by sector").
 */
export interface AskSuggestion {
    /** Shown in the pill. */
    label: string;
    /** Submitted verbatim when the pill is clicked. */
    prompt: string;
}

export const DEFAULT_SUGGESTIONS: AskSuggestion[] = [
    {
        label: "What's my Sharpe by sector?",
        prompt: "What's my Sharpe by sector?",
    },
    {
        label: 'Am I overexposed to AI?',
        prompt: 'Am I overexposed to AI?',
    },
    {
        label: "Where did last month's P&L come from?",
        prompt: "Where did last month's P&L come from?",
    },
    {
        label: 'Which holdings have hurt my alpha this year?',
        prompt: 'Which holdings have hurt my alpha this year?',
    },
];
