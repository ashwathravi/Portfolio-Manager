'use client';

/**
 * AR-115 — Ask Ledger message list.
 *
 * Renders the transcript of a conversation: user turns as right-aligned
 * bubbles, assistant turns as left-aligned bubbles with an expandable
 * kv block underneath pulled from the recorded `toolRuns`.
 *
 * The Markdown renderer here is intentionally small: we support bold
 * (`**x**`), italic underscore (`_x_`), bullet lists, and the custom
 * `[[tool:name#i]]` citation marker. We do NOT use a general-purpose
 * Markdown library — the planner's output shape is fully known, the
 * lede + kv block are the only two surfaces, and a 40-line tokenizer
 * keeps the bundle lean and eliminates a sanitizer dependency.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import type { AskCitation, AskMessage, AskRow, AskToolRun } from '@/lib/ask/types';

// --------------------------------------------------------------------- //
// Tiny markdown → React renderer (safe-by-construction)
// --------------------------------------------------------------------- //

/** Split a line into mixed text + citation-link nodes. */
function renderInline(
    line: string,
    citations: AskCitation[],
    keyPrefix: string,
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    // Tokenise by the citation marker first, then walk each chunk for
    // bold + italic.
    const parts = line.split(/(\[\[tool:[a-zA-Z0-9_#]+\]\])/g);
    parts.forEach((part, i) => {
        const markerMatch = part.match(/^\[\[tool:([a-zA-Z0-9_#]+)\]\]$/);
        if (markerMatch) {
            const marker = `tool:${markerMatch[1]}`;
            const cite = citations.find((c) => c.marker === marker);
            if (cite) {
                nodes.push(
                    <Link
                        key={`${keyPrefix}-c-${i}`}
                        href={cite.href}
                        className="pm-ask-cite"
                        aria-label={`Open ${cite.label}`}
                        data-testid="ask-cite"
                    >
                        <span aria-hidden="true">↗</span>
                    </Link>,
                );
            }
            return;
        }
        nodes.push(...renderFormatting(part, `${keyPrefix}-t-${i}`));
    });
    return nodes;
}

/** Bold (`**x**`) + italic (`_x_`) without touching the DOM as HTML. */
function renderFormatting(text: string, keyPrefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
    let last = 0;
    let match;
    let i = 0;
    while ((match = regex.exec(text))) {
        if (match.index > last) out.push(text.slice(last, match.index));
        const tok = match[0];
        if (tok.startsWith('**')) {
            out.push(<strong key={`${keyPrefix}-b-${i}`}>{tok.slice(2, -2)}</strong>);
        } else {
            out.push(<em key={`${keyPrefix}-i-${i}`}>{tok.slice(1, -1)}</em>);
        }
        last = match.index + tok.length;
        i += 1;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

/** Split the full Markdown body into paragraphs + bullet lists. */
function renderMarkdown(text: string, citations: AskCitation[]): React.ReactNode {
    const lines = text.split('\n');
    const blocks: React.ReactNode[] = [];
    let bulletBuffer: string[] = [];
    let blockKey = 0;

    const flushBullets = () => {
        if (bulletBuffer.length === 0) return;
        const items = bulletBuffer.slice();
        bulletBuffer = [];
        blocks.push(
            <ul key={`bl-${blockKey++}`} className="pm-ask-kv">
                {items.map((line, i) => (
                    <li key={i} className="pm-ask-kv-row">
                        {renderInline(line.replace(/^-\s+/, ''), citations, `${blockKey}-${i}`)}
                    </li>
                ))}
            </ul>,
        );
    };

    lines.forEach((raw) => {
        const line = raw.trimEnd();
        if (line.startsWith('- ')) {
            bulletBuffer.push(line);
            return;
        }
        flushBullets();
        if (line.trim() === '') return;
        blocks.push(
            <p key={`p-${blockKey++}`} className="pm-ask-para">
                {renderInline(line, citations, `${blockKey}`)}
            </p>,
        );
    });
    flushBullets();
    return <>{blocks}</>;
}

// --------------------------------------------------------------------- //
// kv "pill" fallback — for clients that'd rather render rows as chips
// (currently unused; kept as a future alternate view)
// --------------------------------------------------------------------- //
export function AskKvPills({ rows }: { rows: AskRow[] }) {
    return (
        <ul className="pm-ask-pills">
            {rows.map((r, i) => (
                <li
                    key={`${r.label}-${i}`}
                    className="pm-ask-pill"
                    data-tone={r.tone ?? 'neutral'}
                >
                    <span className="pm-ask-pill-label">{r.label}</span>
                    <span className="pm-ask-pill-value">{r.value}</span>
                </li>
            ))}
        </ul>
    );
}

// --------------------------------------------------------------------- //
// Message row
// --------------------------------------------------------------------- //

function ToolRunsFooter({ runs }: { runs: AskToolRun[] }) {
    if (!runs || runs.length === 0) return null;
    return (
        <div className="pm-ask-meta">
            {runs.map((r, i) => (
                <span key={`${r.name}-${i}`} className="pm-ask-tool-chip">
                    {r.name}
                </span>
            ))}
        </div>
    );
}

/** Single assistant or user turn. */
function MessageRow({ msg }: { msg: AskMessage }) {
    const citations = msg.citations ?? [];
    const body = useMemo(() => renderMarkdown(msg.content, citations), [msg.content, citations]);

    return (
        <article
            className="pm-ask-msg"
            data-role={msg.role}
            data-testid={msg.role === 'assistant' ? 'ask-msg-assistant' : 'ask-msg-user'}
        >
            <div className="pm-ask-bubble">
                {body}
                {msg.role === 'assistant' && msg.toolRuns && (
                    <ToolRunsFooter runs={msg.toolRuns} />
                )}
            </div>
        </article>
    );
}

// --------------------------------------------------------------------- //
// List
// --------------------------------------------------------------------- //

export function AskMessageList({ messages }: { messages: AskMessage[] }) {
    if (messages.length === 0) return null;
    return (
        <div className="pm-ask-list" data-testid="ask-message-list">
            {messages.map((m) => (
                <MessageRow key={m.id} msg={m} />
            ))}
        </div>
    );
}
