'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Check, ExternalLink, Plus, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { usePageHeader } from '@/components/layout/PageHeaderContext';
import { SampleTag } from '@/components/data-display/SampleTag';
import { useThesisStore } from '@/lib/research/useThesisStore';
import { isSeedThesis } from '@/lib/research/thesis';
import { checkThesis } from '@/lib/research/thesisCheck';
import { formatPct, formatShortDate, formatUsd } from '@/lib/format';
import { NewThesisModal } from '@/components/research/NewThesisModal';
import { AddCatalystModal } from '@/components/research/AddCatalystModal';
import { AddEvidenceModal } from '@/components/research/AddEvidenceModal';

/**
 * Thesis (/research/thesis/[ticker]) — the canonical, full-page view of a
 * thesis, set as an investment memo: the claim, what would falsify it,
 * the evidence, and what happens next. The Research workspace's detail
 * pane links here ("Open full view").
 */

function dateLabel(value: string): string {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatShortDate(value) : value;
}

export default function ThesisDetailPage() {
    const params = useParams();
    const ticker = ((params?.ticker as string) ?? '').toUpperCase();

    const { findByTicker, update, addCatalyst, addEvidence, hydrated } = useThesisStore();
    const thesis = findByTicker(ticker);

    const [editOpen, setEditOpen] = useState(false);
    const [catalystOpen, setCatalystOpen] = useState(false);
    const [evidenceOpen, setEvidenceOpen] = useState(false);

    const actions = useMemo(
        () =>
            thesis ? (
                <>
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setEditOpen(true)}>
                        Edit
                    </button>
                    <button type="button" className="pm-btn pm-btn-primary" onClick={() => setEvidenceOpen(true)}>
                        <Plus size={14} aria-hidden="true" />
                        <span>Add evidence</span>
                    </button>
                </>
            ) : undefined,
        [thesis],
    );
    usePageHeader({
        title: ticker || 'Thesis',
        subtitle: thesis?.title,
        crumbs: ['Research', 'Theses', ticker],
        actions,
    });

    // Computed once per mount: the check compares dates against "now".
    const [now] = useState(() => Date.now());
    const check = useMemo(() => (thesis ? checkThesis(thesis, now) : null), [thesis, now]);

    if (!hydrated) {
        return (
            <div className="pm-page">
                <p className="pm-empty-line">Loading thesis…</p>
            </div>
        );
    }

    if (!thesis || !check) {
        return (
            <div className="pm-page">
                <section className="pm-card pm-empty-card" data-testid="thesis-not-found">
                    <h2>No thesis for {ticker}</h2>
                    <p>Write down why you own (or avoid) {ticker} and what would prove you wrong before you trade it.</p>
                    <div className="pm-empty-actions">
                        <Link href="/research?tab=theses" className="pm-btn pm-btn-primary">Write a thesis</Link>
                        <Link href={`/portfolios/detail/${encodeURIComponent(ticker)}`} className="pm-btn pm-btn-ghost">View position</Link>
                    </div>
                </section>
            </div>
        );
    }

    const isBull = thesis.type === 'bull';
    const move =
        typeof thesis.currentPrice === 'number' && thesis.currentPrice > 0
            ? ((thesis.targetPrice - thesis.currentPrice) / thesis.currentPrice) * 100
            : null;
    const forCase = isBull ? thesis.bullCase : thesis.bearCase;
    const againstCase = isBull ? thesis.bearCase : thesis.bullCase;

    return (
        <div className="pm-page pm-thesis-page" data-testid="thesis-page">
            <section className="pm-card pm-card-stack">
                <div className="pm-thesis-meta">
                    <span className={`pm-thesis-dir ${isBull ? 'is-bull' : 'is-bear'}`}>{isBull ? 'Bull' : 'Bear'}</span>
                    <span className="pm-thesis-conv">{thesis.conviction.toLowerCase()} conviction</span>
                    {thesis.status === 'archived' && <span className="pm-thesis-conv">archived</span>}
                    {isSeedThesis(thesis) && <SampleTag />}
                    <span className="pm-card-subtitle">
                        {thesis.companyName} · created {formatShortDate(thesis.dateCreated)} · updated {formatShortDate(thesis.dateUpdated)}
                    </span>
                </div>
                {thesis.description && <p className="pm-thesis-lede">{thesis.description}</p>}
                <dl className="pm-metric-strip">
                    <div><dt>Price</dt><dd>{typeof thesis.currentPrice === 'number' ? formatUsd(thesis.currentPrice) : '—'}</dd></div>
                    <div><dt>Target</dt><dd>{formatUsd(thesis.targetPrice)}</dd></div>
                    <div>
                        <dt>{isBull ? 'Upside' : 'Downside'}</dt>
                        <dd>{move === null ? '—' : formatPct(move, { signed: true })}</dd>
                    </div>
                    <div><dt>Horizon</dt><dd>{thesis.timeHorizon || '—'}</dd></div>
                    <div>
                        <dt>Thesis check</dt>
                        <dd data-testid="thesis-check-score">{check.items.filter((i) => i.ok).length}/{check.items.length}</dd>
                    </div>
                </dl>
            </section>

            <div className="pm-thesis-grid">
                <section className="pm-card pm-card-stack pm-thesis-memo">
                    <h2 className="pm-card-title">Hypothesis</h2>
                    <p className="pm-thesis-body">{thesis.hypothesis || 'No hypothesis written yet. Edit the thesis to add one.'}</p>
                    <div className="pm-thesis-cases">
                        <div>
                            <h3 className="pm-thesis-case-title">Supports it</h3>
                            {forCase.length ? (
                                <ol className="pm-thesis-list">{forCase.map((p, i) => <li key={i}>{p}</li>)}</ol>
                            ) : (
                                <p className="pm-empty-line">Nothing recorded.</p>
                            )}
                        </div>
                        <div>
                            <h3 className="pm-thesis-case-title">Would prove it wrong</h3>
                            {againstCase.length ? (
                                <ol className="pm-thesis-list">{againstCase.map((p, i) => <li key={i}>{p}</li>)}</ol>
                            ) : (
                                <p className="pm-empty-line">Nothing recorded — a thesis you can&apos;t falsify can&apos;t be reviewed.</p>
                            )}
                        </div>
                    </div>
                </section>

                <aside className="pm-thesis-side">
                    <section className="pm-card pm-card-stack" data-testid="thesis-check" aria-labelledby="pm-thesis-check">
                        <h2 id="pm-thesis-check" className="pm-card-title">Thesis check</h2>
                        <ul className="pm-thesis-checks">
                            {check.items.map((item) => (
                                <li key={item.id} data-ok={item.ok}>
                                    {item.ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                                    <span>
                                        <strong>{item.label}</strong>
                                        <span className="pm-card-subtitle">{item.detail}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="pm-card pm-card-stack" aria-labelledby="pm-thesis-catalysts">
                        <header className="pm-thesis-side-head">
                            <h2 id="pm-thesis-catalysts" className="pm-card-title">Catalysts</h2>
                            <button type="button" className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => setCatalystOpen(true)}>
                                <Plus size={12} aria-hidden="true" />
                                <span>Add</span>
                            </button>
                        </header>
                        {thesis.catalysts.length ? (
                            <ul className="pm-thesis-rows">
                                {thesis.catalysts.map((c) => (
                                    <li key={c.id}>
                                        <span>{c.title}</span>
                                        <span className="pm-card-subtitle">{dateLabel(c.date)} · {c.impact} impact</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="pm-empty-line">No catalysts tracked.</p>
                        )}
                    </section>

                    <section className="pm-card pm-card-stack" aria-labelledby="pm-thesis-evidence">
                        <header className="pm-thesis-side-head">
                            <h2 id="pm-thesis-evidence" className="pm-card-title">Evidence</h2>
                            <button type="button" className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => setEvidenceOpen(true)}>
                                <Plus size={12} aria-hidden="true" />
                                <span>Add</span>
                            </button>
                        </header>
                        {thesis.linkedEvidence.length ? (
                            <ul className="pm-thesis-rows">
                                {thesis.linkedEvidence.map((e) => (
                                    <li key={e.id}>
                                        {e.url ? (
                                            <a href={e.url} target="_blank" rel="noopener noreferrer">
                                                {e.title} <ExternalLink size={12} aria-hidden="true" />
                                            </a>
                                        ) : (
                                            <span>{e.title}</span>
                                        )}
                                        <span className="pm-card-subtitle">{e.type} · {dateLabel(e.date)}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="pm-empty-line">No evidence linked yet.</p>
                        )}
                    </section>

                    <div className="pm-empty-actions">
                        <Link href={`/portfolios/detail/${encodeURIComponent(thesis.ticker)}`} className="pm-btn pm-btn-ghost">View position</Link>
                        <Link href={`/execution?symbol=${encodeURIComponent(thesis.ticker)}`} className="pm-btn pm-btn-ghost">Draft order</Link>
                    </div>
                </aside>
            </div>

            <NewThesisModal open={editOpen} onOpenChange={setEditOpen} editing={thesis} onSubmit={(draft) => update(thesis.id, draft)} />
            <AddCatalystModal open={catalystOpen} onOpenChange={setCatalystOpen} onSubmit={(catalyst) => addCatalyst(thesis.id, catalyst)} />
            <AddEvidenceModal open={evidenceOpen} onOpenChange={setEvidenceOpen} onSubmit={(evidence) => addEvidence(thesis.id, evidence)} />
        </div>
    );
}
