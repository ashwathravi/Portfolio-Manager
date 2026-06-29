"use client";

import { useEffect } from 'react';
import { toast } from 'sonner';
import { evaluateAlphaRadarAlerts } from './alpha-radar';
import { useAlertsStore } from '@/lib/stores/alertsStore';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import type {
    AlphaRadarMemoChange,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from '@/lib/alpha-radar';

export function useAlphaRadarAlertEngine(input: {
    changes: readonly AlphaRadarMemoChange[];
    reports: readonly AlphaRadarReportRecord[];
    filers: readonly AlphaRadarTrackedFilerRecord[];
}) {
    const rules = useAlertsStore((state) => state.rules);
    const recordTriggers = useAlertsStore((state) => state.recordTriggers);
    const alphaRadarSignals = useSettingsStore((state) => state.notifications.alphaRadarSignals);

    useEffect(() => {
        if (!alphaRadarSignals || input.changes.length === 0) return;

        const existingTriggerIds = new Set(useAlertsStore.getState().triggers.map((trigger) => trigger.id));
        const triggers = evaluateAlphaRadarAlerts({
            rules,
            changes: input.changes,
            reports: input.reports,
            filers: input.filers,
            observedAt: new Date().toISOString(),
            existingTriggerIds,
        });
        if (triggers.length === 0) return;

        recordTriggers(triggers);
        for (const trigger of triggers) {
            toast(trigger.ruleName, {
                description: trigger.message,
            });
        }
    }, [alphaRadarSignals, input.changes, input.filers, input.reports, recordTriggers, rules]);
}
