import { getEasternParts } from '@/lib/markets/market-hours';
import { tickerSchema } from '@/lib/validators/market-data';

/** Blotter rows newest first (by when they were drafted), ties broken by id for stability. */
export function sortOrdersNewestFirst<T extends { id: string; createdAt: Date | string }>(orders: readonly T[]): T[] {
    const time = (o: T) => new Date(o.createdAt).getTime();
    return [...orders].sort((a, b) => time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const TIME = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' });
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const DATE_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

/**
 * When a plan was drafted, in market time (ET) like the app clock: the time
 * for today's (`today` is the Eastern date), else the date, with the year
 * when it isn't this one.
 */
export function formatPlanTime(createdAt: string, today: string): string {
    const at = new Date(createdAt);
    if (Number.isNaN(at.getTime())) return '—';
    const date = getEasternParts(at).date;
    if (date === today) return TIME.format(at);
    return (date.slice(0, 4) === today.slice(0, 4) ? DATE : DATE_YEAR).format(at);
}

export interface OrderPrefill {
    ticker?: string;
    side?: 'buy' | 'sell';
}

/**
 * Reads `?symbol=` and `?side=` from the URL so other screens (position
 * detail, Ask answers) can open a pre-filled ticket. Invalid input is ignored.
 */
export function parseOrderPrefill(params: { get(name: string): string | null }): OrderPrefill {
    const out: OrderPrefill = {};
    const raw = params.get('symbol')?.trim().toUpperCase();
    if (raw && tickerSchema.safeParse(raw).success) out.ticker = raw;
    const side = params.get('side')?.trim().toLowerCase();
    if (side === 'buy' || side === 'sell') out.side = side;
    return out;
}
