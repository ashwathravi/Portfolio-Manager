import type { Quote } from '@/types/market-data';

import { getEasternParts } from './market-hours';

/**
 * True when a quote's change is a known move from today's session: a live
 * quote, or a closing quote from today's session (Eastern date). Before
 * today's close, the newest closing quote is the previous session's, so its
 * change must not be shown or counted as "today". A quote with no earlier
 * close to compare with has no move at all.
 */
export function isTodaysQuote<Q extends Pick<Quote, 'timestamp' | 'isRealtime' | 'change' | 'changePercent'>>(
  quote: Q,
  /** Now, or today's Eastern date as YYYY-MM-DD (see useEasternDate). */
  today: Date | string = new Date(),
): quote is Q & { change: number; changePercent: number } {
  if (!Number.isFinite(quote.change) || !Number.isFinite(quote.changePercent)) return false;
  if (quote.isRealtime) return true;
  const at = new Date(quote.timestamp);
  if (Number.isNaN(at.getTime())) return false;
  const todayEt = typeof today === 'string' ? today : getEasternParts(today).date;
  return getEasternParts(at).date === todayEt;
}
