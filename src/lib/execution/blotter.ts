import { tickerSchema } from '@/lib/validators/market-data';

/** Blotter rows newest first (by placement time), ties broken by id for stability. */
export function sortOrdersNewestFirst<T extends { id: string; placedAt: Date | string }>(orders: readonly T[]): T[] {
    const time = (o: T) => new Date(o.placedAt).getTime();
    return [...orders].sort((a, b) => time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
