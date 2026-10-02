import { ALL_DESTINATIONS, type NavDestination } from '@/lib/navigation';
import { tickerSchema } from '@/lib/validators/market-data';

/**
 * ⌘K command palette search. One box for the three things people reach
 * for: jump to a page, open a ticker or thesis, or ask a question.
 */

export type CommandGroup = 'Ask' | 'Go to' | 'Symbols' | 'Theses';

export interface CommandItem {
    id: string;
    group: CommandGroup;
    label: string;
    hint?: string;
    /** Navigate here when chosen. */
    href?: string;
    /** Open Ask Ledger with this question ('' opens it empty). */
    ask?: string;
}

export interface CommandThesis {
    ticker: string;
    title: string;
    status: string;
}

const QUESTION_START = /^(what|how|which|why|where|when|who|am|is|are|do|does|did|should|can|show|list)\b/i;

export function looksLikeQuestion(query: string): boolean {
    const q = query.trim();
    return q.endsWith('?') || (QUESTION_START.test(q) && q.split(/\s+/).length >= 3);
}

function matches(haystack: string, tokens: string[]): boolean {
    const h = haystack.toLowerCase();
    return tokens.every((t) => h.includes(t));
}

/** 3 = a label word starts with every token, 2 = label contains them, 1 = only the description does. */
function score(label: string, hint: string, tokens: string[]): number {
    if (tokens.length === 0) return 1;
    const l = label.toLowerCase();
    if (!matches(`${label} ${hint}`, tokens)) return 0;
    const words = l.split(/[\s›]+/).filter(Boolean);
    if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 3;
    if (matches(label, tokens)) return 2;
    return 1;
}

function destinationItems(tokens: string[]): CommandItem[] {
    const out: { item: CommandItem; score: number; order: number }[] = [];
    const push = (label: string, href: string, hint: string) => {
        const sc = score(label, hint, tokens);
        if (sc > 0) out.push({ item: { id: `nav:${href}`, group: 'Go to', label, href, hint }, score: sc, order: out.length });
    };
    for (const d of ALL_DESTINATIONS as readonly NavDestination[]) {
        push(d.title, d.href, d.description);
        for (const tab of d.tabs ?? []) {
            if (tab.href !== d.href) push(`${d.title} › ${tab.label}`, tab.href, d.description);
        }
    }
    return out.sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.item);
}

export function searchCommands(query: string, ctx: { theses?: readonly CommandThesis[] } = {}, limitPerGroup = 6): CommandItem[] {
    const q = query.trim();
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const groups: Record<CommandGroup, CommandItem[]> = { Ask: [], 'Go to': [], Symbols: [], Theses: [] };

    groups['Go to'] = destinationItems(tokens);
    if (!q) {
        groups.Ask = [{ id: 'ask-open', group: 'Ask', label: 'Ask Ledger', hint: 'Ask a question about your book', ask: '' }];
    }

    if (q) {
        groups.Theses = (ctx.theses ?? [])
            .filter((t) => matches(`${t.ticker} ${t.title}`, tokens))
            .map((t) => ({
                id: `thesis:${t.ticker}`,
                group: 'Theses' as const,
                label: `${t.ticker} — ${t.title}`,
                hint: t.status === 'archived' ? 'Archived thesis' : 'Thesis',
                href: `/research/thesis/${encodeURIComponent(t.ticker)}`,
            }));

        const symbol = q.toUpperCase();
        if (!q.includes(' ') && symbol.length <= 10 && tickerSchema.safeParse(symbol).success) {
            groups.Symbols = [
                { id: `symbol:${symbol}`, group: 'Symbols', label: `Open ${symbol}`, hint: 'Position, quote, and thesis', href: `/portfolios/detail/${encodeURIComponent(symbol)}` },
                { id: `order:${symbol}`, group: 'Symbols', label: `Draft an order for ${symbol}`, hint: 'Trade', href: `/execution?symbol=${encodeURIComponent(symbol)}` },
            ];
        }

        groups.Ask = [{ id: 'ask', group: 'Ask', label: `Ask: “${q}”`, hint: 'Ask Ledger answers from your book, journal, and performance', ask: q }];
    }

    const order: CommandGroup[] = !q || looksLikeQuestion(q)
        ? ['Ask', 'Theses', 'Symbols', 'Go to']
        : ['Go to', 'Symbols', 'Theses', 'Ask'];
    return order.flatMap((g) => groups[g].slice(0, limitPerGroup));
}
