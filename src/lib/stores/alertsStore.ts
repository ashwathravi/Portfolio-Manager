import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AlertRule, AlertTrigger } from '@/lib/alerts/types';

const MAX_TRIGGER_LOG = 200;

export interface AlertsState {
    rules: AlertRule[];
    triggers: AlertTrigger[];

    addRule: (rule: Omit<AlertRule, 'id' | 'createdAt'>) => AlertRule;
    updateRule: (id: string, updates: Partial<Omit<AlertRule, 'id' | 'createdAt'>>) => void;
    deleteRule: (id: string) => void;
    toggleRule: (id: string) => void;

    recordTriggers: (triggers: AlertTrigger[]) => void;
    acknowledgeTrigger: (id: string) => void;
    acknowledgeAll: () => void;
    clearTriggers: () => void;
}

const defaultRules: AlertRule[] = [
    {
        id: 'seed-aapl',
        name: 'AAPL above $200',
        metric: 'price',
        symbol: 'AAPL',
        comparator: 'gte',
        threshold: 200,
        enabled: true,
        rearm: 'daily',
        note: 'Trim position if momentum holds.',
        createdAt: '2026-04-01T09:30:00Z',
    },
    {
        id: 'seed-portfolio-dip',
        name: 'Portfolio drawdown > 2%',
        metric: 'portfolio_day_change_pct',
        comparator: 'lte',
        threshold: -0.02,
        enabled: true,
        rearm: 'daily',
        createdAt: '2026-04-01T09:30:00Z',
    },
    {
        id: 'seed-alpha-radar-overlap',
        name: 'Alpha Radar overlap score ≥ 80',
        metric: 'alpha_radar_user_overlap',
        comparator: 'gte',
        threshold: 80,
        enabled: true,
        rearm: 'always',
        note: 'Review the source 13F report before acting.',
        source: 'alpha_radar',
        createdAt: '2026-04-01T09:30:00Z',
    },
];

export const useAlertsStore = create<AlertsState>()(
    persist(
        (set) => ({
            rules: defaultRules,
            triggers: [],

            addRule: (rule) => {
                const created: AlertRule = {
                    ...rule,
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                };
                set((state) => ({ rules: [...state.rules, created] }));
                return created;
            },

            updateRule: (id, updates) =>
                set((state) => ({
                    rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
                })),

            deleteRule: (id) =>
                set((state) => ({
                    rules: state.rules.filter((r) => r.id !== id),
                    triggers: state.triggers.filter((t) => t.ruleId !== id),
                })),

            toggleRule: (id) =>
                set((state) => ({
                    rules: state.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
                })),

            recordTriggers: (incoming) =>
                set((state) => {
                    if (incoming.length === 0) return state;
                    const existingIds = new Set(state.triggers.map((t) => t.id));
                    const fresh = incoming.filter((t) => !existingIds.has(t.id));
                    if (fresh.length === 0) return state;

                    const updatedRules = state.rules.map((rule) => {
                        const fired = fresh.find((t) => t.ruleId === rule.id);
                        if (!fired) return rule;
                        const nextRule: AlertRule = { ...rule, lastTriggeredAt: fired.triggeredAt };
                        if (rule.rearm === 'once') nextRule.enabled = false;
                        return nextRule;
                    });

                    const merged = [...fresh, ...state.triggers].slice(0, MAX_TRIGGER_LOG);
                    return { rules: updatedRules, triggers: merged };
                }),

            acknowledgeTrigger: (id) =>
                set((state) => ({
                    triggers: state.triggers.map((t) => (t.id === id ? { ...t, acknowledged: true } : t)),
                })),

            acknowledgeAll: () =>
                set((state) => ({
                    triggers: state.triggers.map((t) => ({ ...t, acknowledged: true })),
                })),

            clearTriggers: () => set({ triggers: [] }),
        }),
        {
            name: 'atlas-alerts',
            partialize: (state) => ({ rules: state.rules, triggers: state.triggers }),
        },
    ),
);

export function selectUnacknowledgedCount(state: AlertsState): number {
    return state.triggers.filter((t) => !t.acknowledged).length;
}
