'use client';

import { useEffect, useState } from 'react';

import { getEasternParts } from '@/lib/markets/market-hours';

/**
 * Today's Eastern calendar date (YYYY-MM-DD), re-read every minute so that
 * memoized "today" figures recompute when the date changes; a tab left open
 * overnight must stop treating yesterday's close as today's.
 */
export function useEasternDate(): string {
    const [date, setDate] = useState(() => getEasternParts(new Date()).date);
    useEffect(() => {
        const id = window.setInterval(() => {
            const next = getEasternParts(new Date()).date;
            setDate((current) => (current === next ? current : next));
        }, 60_000);
        return () => window.clearInterval(id);
    }, []);
    return date;
}
