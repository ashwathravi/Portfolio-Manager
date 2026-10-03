'use client';

import Link from 'next/link';
import { useThesisStore } from '@/lib/research/useThesisStore';
import { useWatchlist } from '@/lib/research/useWatchlist';
import { findThesisByTicker } from '@/lib/research/thesis';
import { formatPct, formatQty, formatUsd } from '@/lib/format';

export interface AccountPosition {
    portfolioId: string;
    name: string;
    shares: number;
    avgCost: number;
    value: number;
    gain: number;
}

export interface HoldingDetail {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    totalShares: number;
    totalEquity: number;
    avgCost: number;
    costBasis: number;
    totalReturn: number;
    returnPercent: number;
    accounts: AccountPosition[];
}

export interface SymbolQuote {
    price: number;
    change: number;
    changePercent: number;
}

/**
 * Position detail (/portfolios/detail/[symbol]).
 *
 * Works for any symbol: when you hold it, it shows the position across
 * accounts; when you don't, it shows the quote (if available) and the two
 * useful next steps — read or write the thesis, or draft an order —
 * instead of the old "No holdings" dead end.
 */
export function HoldingDetailView({
    symbol,
    holding,
    quote,
}: {
    symbol: string;
    holding: HoldingDetail | null;
    quote: SymbolQuote | null;
}) {
    const { theses } = useThesisStore();
    const watchlist = useWatchlist();
    const watched = watchlist.isWatched(symbol);
    const thesis = findThesisByTicker(theses, symbol);
    const price = holding?.price ?? quote?.price ?? null;
    const change = holding?.changePercent ?? quote?.changePercent ?? null;

    return (
        <div className="pm-page" data-testid="position-detail">
            <section className="pm-card pm-card-stack">
                <header className="pm-position-head">
                    <div>
                        <p className="pm-card-subtitle">{holding?.name ?? 'Quote'}</p>
                        <p className="pm-position-price" data-testid="position-price">
                            {price === null ? 'Quote unavailable' : formatUsd(price)}
                            {change !== null && price !== null && (
                                <span className={change > 0 ? 'pm-pos' : change < 0 ? 'pm-neg' : 'pm-metric-note'}>
                                    {' '}{formatPct(change, { signed: true, decimals: 2 })} today
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="pm-empty-actions">
                        <button
                            type="button"
                            className="pm-btn pm-btn-ghost"
                            aria-pressed={watched}
                            onClick={() => (watched ? watchlist.remove(symbol) : watchlist.add(symbol, holding?.name))}
                        >
                            {watched ? 'On watchlist ✓' : 'Add to watchlist'}
                        </button>
                        <Link href={`/execution?symbol=${encodeURIComponent(symbol)}`} className="pm-btn pm-btn-primary">
                            Draft order
                        </Link>
                    </div>
                </header>

                {holding ? (
                    <dl className="pm-metric-strip" data-testid="position-summary">
                        <div><dt>Shares</dt><dd>{formatQty(holding.totalShares)}</dd></div>
                        <div><dt>Market value</dt><dd>{formatUsd(holding.totalEquity)}</dd></div>
                        <div><dt>Avg cost</dt><dd>{formatUsd(holding.avgCost)}</dd></div>
                        <div><dt>Cost basis</dt><dd>{formatUsd(holding.costBasis)}</dd></div>
                        <div>
                            <dt>Unrealized</dt>
                            <dd className={holding.totalReturn > 0 ? 'is-pos' : holding.totalReturn < 0 ? 'is-neg' : undefined}>
                                {formatUsd(holding.totalReturn, { signed: true })}{' '}
                                <span className="pm-metric-note">{formatPct(holding.returnPercent, { signed: true })}</span>
                            </dd>
                        </div>
                    </dl>
                ) : (
                    <p className="pm-empty-line" data-testid="position-not-held">
                        You don&apos;t hold {symbol} in any connected account.
                    </p>
                )}
            </section>

            {holding && holding.accounts.length > 0 && (
                <section className="pm-card pm-card-stack" aria-labelledby="pm-position-accounts">
                    <h2 id="pm-position-accounts" className="pm-card-title">By account</h2>
                    <div className="pm-table-scroll">
                        <table className="pm-table-full">
                            <thead>
                                <tr>
                                    <th scope="col">Account</th>
                                    <th scope="col" className="num">Shares</th>
                                    <th scope="col" className="num">Avg cost</th>
                                    <th scope="col" className="num">Value</th>
                                    <th scope="col" className="num">Unrealized</th>
                                </tr>
                            </thead>
                            <tbody>
                                {holding.accounts.map((a) => (
                                    <tr key={a.portfolioId}>
                                        <td>{a.name}</td>
                                        <td className="num">{formatQty(a.shares)}</td>
                                        <td className="num">{formatUsd(a.avgCost)}</td>
                                        <td className="num">{formatUsd(a.value)}</td>
                                        <td className={`num ${a.gain > 0 ? 'pm-pos' : a.gain < 0 ? 'pm-neg' : ''}`}>
                                            {formatUsd(a.gain, { signed: true })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <section className="pm-card pm-card-stack" data-testid="position-thesis" aria-labelledby="pm-position-thesis">
                <h2 id="pm-position-thesis" className="pm-card-title">Thesis</h2>
                {thesis ? (
                    <>
                        <p className="pm-position-thesis-title">{thesis.title}</p>
                        <p className="pm-card-subtitle">
                            {thesis.conviction} conviction · target {formatUsd(thesis.targetPrice)} · {thesis.timeHorizon}
                        </p>
                        <div className="pm-empty-actions">
                            <Link href={`/research/thesis/${encodeURIComponent(symbol)}`} className="pm-btn pm-btn-ghost">
                                Open thesis
                            </Link>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="pm-empty-line">No written thesis for {symbol}. Write one before adding to the position.</p>
                        <div className="pm-empty-actions">
                            <Link href="/research?tab=theses" className="pm-btn pm-btn-ghost">Write a thesis</Link>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
