/**
 * Shared display formatters. Uses the true minus sign (−) for negatives so
 * signed figures line up in tabular columns.
 */

export function formatUsd(value: number, opts: { signed?: boolean; decimals?: number } = {}): string {
    const { signed = false, decimals = 2 } = opts;
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    const isZero = Number(abs.replace(/,/g, '')) === 0;
    const sign = value < 0 && !isZero ? '−' : signed && value > 0 && !isZero ? '+' : '';
    return `${sign}$${abs}`;
}

export function formatPct(value: number | null | undefined, opts: { signed?: boolean; decimals?: number } = {}): string {
    const { signed = false, decimals = 1 } = opts;
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const abs = Math.abs(value).toFixed(decimals);
    const isZero = Number(abs) === 0;
    const sign = value < 0 && !isZero ? '−' : signed && value > 0 && !isZero ? '+' : '';
    return `${sign}${abs}%`;
}

export function formatQty(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** "Feb 6, 2026" in UTC so server and client renders agree. */
export function formatShortDate(iso: string | Date | null | undefined): string {
    if (!iso) return '—';
    const d = iso instanceof Date ? iso : new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
