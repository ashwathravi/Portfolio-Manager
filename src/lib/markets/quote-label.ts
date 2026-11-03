import type { Quote } from "@/types/market-data";

import { formatEtClock, getEasternParts } from "./market-hours";

/**
 * Plain words for what a price is (launch item i33): a delayed quote with the
 * time it was quoted, or a session's close with its date. Atlas has no
 * real-time feed, so nothing is ever called live.
 */

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Labelled = Pick<Quote, "kind" | "timestamp">;

/** "Oct 30", or "Dec 31, 2025" outside `today`'s year; both Eastern dates. */
export function formatSessionDate(date: string, today: string): string {
    const day = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) return date;
    return (date.slice(0, 4) === today.slice(0, 4) ? MONTH_DAY : MONTH_DAY_YEAR).format(day);
}

function quotedAt(quote: Labelled): Date | null {
    const at = new Date(quote.timestamp);
    return Number.isNaN(at.getTime()) ? null : at;
}

/** "10:42 AM ET", with the day in front when it isn't `today`. */
function delayedTime(at: Date, today: string): string {
    const date = getEasternParts(at).date;
    return date === today ? formatEtClock(at) : `${formatSessionDate(date, today)} ${formatEtClock(at)}`;
}

/** One price: "Delayed quote, 10:42 AM ET", "Today's close" or "Last close, Oct 30". */
export function describeQuote(quote: Labelled, today: string): string {
    const at = quotedAt(quote);
    if (quote.kind === "delayed") return at ? `Delayed quote, ${delayedTime(at, today)}` : "Delayed quote";
    if (!at) return "Last close";
    const date = getEasternParts(at).date;
    return date === today ? "Today's close" : `Last close, ${formatSessionDate(date, today)}`;
}

/**
 * Several prices at once, for a page's freshness line: what they all are, or
 * how many are delayed. A set of delayed quotes is as old as its oldest.
 * Null without any prices.
 */
export function describeQuotes(quotes: Iterable<Labelled>, today: string): string | null {
    const all = [...quotes];
    if (all.length === 0) return null;
    const delayed = all.filter((quote) => quote.kind === "delayed");

    if (delayed.length === all.length) {
        const times = delayed.map(quotedAt).filter((at): at is Date => at !== null).map(Number);
        if (times.length === 0) return "Delayed quotes";
        return `Delayed quotes, as of ${delayedTime(new Date(Math.min(...times)), today)}`;
    }
    if (delayed.length > 0) return `Delayed quotes for ${delayed.length} of ${all.length}, last closes for the rest`;

    const dates = [...new Set(all.map(quotedAt).filter((at): at is Date => at !== null).map((at) => getEasternParts(at).date))].sort();
    const latest = dates.at(-1);
    if (!latest) return "Closing prices";
    const when = latest === today ? "today" : formatSessionDate(latest, today);
    return dates.length === 1 ? `Closing prices from ${when}` : `Closing prices, the latest from ${when}`;
}
