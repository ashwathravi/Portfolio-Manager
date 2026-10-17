import type { Quote } from '@/types/market-data';

import { getEasternParts } from './market-hours';

/**
 * True when a quote's change is today's move: a live quote, or a closing
 * quote from today's session (Eastern date). Before today's close, the newest
 * closing quote is the previous session's, so its change must not be shown
 * or counted as "today".
 */
export function isTodaysQuote(
  quote: Pick<Quote, 'timestamp' | 'isRealtime'>,
  /** Now, or today's Eastern date as YYYY-MM-DD (see useEasternDate). */
  today: Date | string = new Date(),
): boolean {
  if (quote.isRealtime) return true;
  const at = new Date(quote.timestamp);
  if (Number.isNaN(at.getTime())) return false;
  const todayEt = typeof today === 'string' ? today : getEasternParts(today).date;
  return getEasternParts(at).date === todayEt;
}
