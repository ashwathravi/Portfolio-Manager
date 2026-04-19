"use client";

import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useQuotesQuery } from '@/lib/api/market-data/queries';
import { useAlertsStore } from '@/lib/stores/alertsStore';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import { evaluateAlerts } from './evaluator';
import type { MarketSnapshot } from './types';

/**
 * Mount once (per app) to evaluate alert rules against live quotes.
 * Polls the quotes query on the user's configured refresh interval, builds
 * a snapshot, and records any new triggers into the alerts store.
 */
export function useAlertEngine() {
    const rules = useAlertsStore((s) => s.rules);
    const recordTriggers = useAlertsStore((s) => s.recordTriggers);
    const refreshSeconds = useSettingsStore((s) => s.preferences.marketDataRefreshSeconds);

    const symbols = useMemo(() => {
        const set = new Set<string>();
        for (const rule of rules) {
            if (!rule.enabled) continue;
            if (rule.metric === 'price' || rule.metric === 'price_change_pct') {
                if (rule.symbol) set.add(rule.symbol.toUpperCase());
            }
        }
        return [...set].sort();
    }, [rules]);

    const { data: quotesMap } = useQuotesQuery(symbols, {
        refetchInterval: Math.max(refreshSeconds, 15) * 1000,
        staleTime: Math.max(refreshSeconds, 15) * 1000,
    });

    useEffect(() => {
        if (!quotesMap || Object.keys(quotesMap).length === 0) return;

        const snapshot: MarketSnapshot = {
            quotes: Object.fromEntries(
                Object.entries(quotesMap).map(([sym, q]) => [
                    sym.toUpperCase(),
                    { price: q.price, changePercent: q.changePercent / 100 },
                ]),
            ),
            portfolioValue: 0,
            portfolioDayChangePct: 0,
            observedAt: new Date().toISOString(),
        };

        const triggers = evaluateAlerts(rules, snapshot);
        if (triggers.length === 0) return;

        const existingIds = new Set(useAlertsStore.getState().triggers.map((t) => t.id));
        const fresh = triggers.filter((t) => !existingIds.has(t.id));
        if (fresh.length === 0) return;

        recordTriggers(fresh);
        for (const t of fresh) {
            toast(`${t.ruleName} triggered`, {
                description: `Observed ${formatValue(t.metric, t.observedValue)}`,
            });
        }
    }, [quotesMap, rules, recordTriggers]);
}

function formatValue(metric: string, value: number): string {
    if (metric === 'price' || metric === 'portfolio_value') {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const sign = value > 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
}
