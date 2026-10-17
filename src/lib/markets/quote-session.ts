import type { Quote } from '@/types/market-data';

import { getEasternParts } from './market-hours';

/**
 * True when a quote's change is today's move: a live quote, or a closing
 * quote from today's session (Eastern date). Before today's close, the newest
 * closing quote is the previous session's, so its change must not be shown
 * or counted as "today".
 */
export function isTodaysQuote(quote: Pick<Quote, 'timestamp' | 'isRealtime'>, now: Date = new Date()): boolean {
  if (quote.isRealtime) return true;
  const at = new Date(quote.timestamp);
  if (Number.isNaN(at.getTime())) return false;
  return getEasternParts(at).date === getEasternParts(now).date;
}
