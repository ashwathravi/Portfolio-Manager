import type { Metadata } from 'next';
import { AskSheet } from '@/components/ask/AskSheet';
import { PageHeaderSync } from '@/components/layout/TopBar';

export const metadata: Metadata = {
    title: 'Ask Ledger · Atlas Wealth',
    description: 'Natural-language queries over your portfolio, journal, and performance.',
};

/**
 * AR-115 — dedicated /ask page.
 *
 * Full-bleed chat surface for users who'd rather type questions in a
 * committed tab than a transient overlay. Uses the same `AskSheet`
 * component (with `variant="page"`) so both surfaces stay in lockstep.
 */
export default function AskPage() {
    return (
        <div className="pm-ask-page" data-testid="ask-page">
            <PageHeaderSync
                title="Ask Ledger"
                subtitle="Natural-language questions over your book, journal, and performance"
                crumbs={['Workspace', 'Ask Ledger']}
            />
            <AskSheet variant="page" />
        </div>
    );
}
