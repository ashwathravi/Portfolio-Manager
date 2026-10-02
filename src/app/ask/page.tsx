import type { Metadata } from 'next';
import { AskSheet } from '@/components/ask/AskSheet';
import { PageHeaderSync } from '@/components/layout/TopBar';

export const metadata: Metadata = {
    title: 'Ask · Atlas Wealth',
    description: 'Natural-language queries over your portfolio, journal, and performance.',
};

/**
 * Ask (/ask) — your question history.
 *
 * The primary way to ask is ⌘K from anywhere (CommandCenter hands the
 * question to Ask Ledger). This page keeps the full conversation in a
 * tab and shares the same `AskSheet` (variant="page") and history.
 */
export default function AskPage() {
    return (
        <div className="pm-ask-page" data-testid="ask-page">
            <PageHeaderSync
                title="Ask"
                subtitle="Your questions and answers. Press ⌘K anywhere to ask."
                crumbs={['Ask']}
            />
            <AskSheet variant="page" />
        </div>
    );
}
