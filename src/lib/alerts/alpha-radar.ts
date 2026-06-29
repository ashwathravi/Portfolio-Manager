import type {
    AlertRule,
    AlertTrigger,
    AlphaRadarAlertMetric,
} from './types';
import { compare } from './evaluator';
import { isAlphaRadarAlertMetric } from './metrics';
import type {
    AlphaRadarMemoChange,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from '@/lib/alpha-radar';
export { isAlphaRadarAlertMetric, isMarketAlertMetric } from './metrics';

export interface AlphaRadarAlertEvaluationInput {
    rules: readonly AlertRule[];
    changes: readonly AlphaRadarMemoChange[];
    reports: readonly AlphaRadarReportRecord[];
    filers: readonly AlphaRadarTrackedFilerRecord[];
    observedAt: string;
    existingTriggerIds?: ReadonlySet<string>;
}

const ALPHA_RADAR_RESEARCH_HREF = '/research?tab=alpha-radar';
type AlphaRadarAlertRule = AlertRule & { metric: AlphaRadarAlertMetric };

export function evaluateAlphaRadarAlerts(input: AlphaRadarAlertEvaluationInput): AlertTrigger[] {
    const alphaRules = input.rules.filter(isAlphaRadarAlertRule);
    if (alphaRules.length === 0 || input.changes.length === 0) return [];

    const filerById = new Map(input.filers.map((filer) => [filer.id, filer] as const));
    const reportByFilerPeriod = new Map(
        input.reports.map((report) => [`${report.trackedFilerId}:${report.reportPeriod}`, report] as const),
    );
    const triggers: AlertTrigger[] = [];

    for (const rule of alphaRules) {
        if (!canFireAlphaRadarRule(rule, input.observedAt)) continue;

        for (const change of input.changes) {
            if (!matchesAlphaRadarMetric(rule.metric, change)) continue;
            if (!compare(change.materialityScore, rule.comparator, rule.threshold)) continue;

            const filer = filerById.get(change.trackedFilerId);
            const report = reportByFilerPeriod.get(`${change.trackedFilerId}:${change.reportPeriod}`);
            const id = makeAlphaRadarTriggerId(rule.id, change);
            if (input.existingTriggerIds?.has(id)) continue;

            triggers.push({
                id,
                ruleId: rule.id,
                ruleName: rule.name,
                metric: rule.metric,
                comparator: rule.comparator,
                threshold: rule.threshold,
                observedValue: change.materialityScore,
                triggeredAt: input.observedAt,
                acknowledged: false,
                source: 'alpha_radar',
                message: buildAlphaRadarNotificationCopy(change, filer?.name ?? 'Tracked filer'),
                href: ALPHA_RADAR_RESEARCH_HREF,
                alphaRadar: {
                    trackedFilerId: change.trackedFilerId,
                    filerName: filer?.name ?? 'Tracked filer',
                    reportId: report?.id,
                    reportPeriod: change.reportPeriod,
                    filingId: change.currentFilingId,
                    issuerName: change.issuerName,
                    ticker: change.ticker,
                    cusip: change.cusip,
                    changeType: change.changeType,
                    materialityScore: change.materialityScore,
                    relevanceReasons: change.userRelevance.reasons,
                },
            });
        }
    }

    return triggers;
}

function isAlphaRadarAlertRule(rule: AlertRule): rule is AlphaRadarAlertRule {
    return isAlphaRadarAlertMetric(rule.metric);
}

function canFireAlphaRadarRule(rule: AlertRule, observedAt: string): boolean {
    if (!rule.enabled) return false;
    if (!rule.lastTriggeredAt) return true;
    if (rule.rearm === 'once') return false;
    if (rule.rearm === 'always') return true;

    const last = new Date(rule.lastTriggeredAt);
    const now = new Date(observedAt);
    return (
        last.getUTCFullYear() !== now.getUTCFullYear() ||
        last.getUTCMonth() !== now.getUTCMonth() ||
        last.getUTCDate() !== now.getUTCDate()
    );
}

function matchesAlphaRadarMetric(metric: AlphaRadarAlertMetric, change: AlphaRadarMemoChange): boolean {
    switch (metric) {
        case 'alpha_radar_new_position':
            return change.changeType === 'new';
        case 'alpha_radar_exit':
            return change.changeType === 'exited';
        case 'alpha_radar_large_add':
            return change.changeType === 'increased';
        case 'alpha_radar_large_trim':
            return change.changeType === 'decreased';
        case 'alpha_radar_user_overlap':
            return hasUserOverlap(change);
    }
}

function hasUserOverlap(change: AlphaRadarMemoChange): boolean {
    return (
        change.userRelevance.portfolio ||
        change.userRelevance.watchlist ||
        change.userRelevance.thesis ||
        change.userRelevance.reasons.length > 0
    );
}

function makeAlphaRadarTriggerId(ruleId: string, change: AlphaRadarMemoChange): string {
    const filing = change.currentFilingId ?? change.priorFilingId ?? 'unknown-filing';
    return [
        'alpha-radar',
        ruleId,
        change.trackedFilerId,
        change.reportPeriod,
        filing,
        change.cusip,
        change.changeType,
    ].join(':');
}

function buildAlphaRadarNotificationCopy(change: AlphaRadarMemoChange, filerName: string): string {
    const issuer = change.ticker ? `${change.issuerName} (${change.ticker})` : change.issuerName;
    const reason = change.userRelevance.reasons.length > 0
        ? ` ${change.userRelevance.reasons.join(', ')}.`
        : '';
    return `${filerName} ${formatChangeType(change.changeType)} ${issuer} in ${change.reportPeriod}. Materiality ${change.materialityScore}/100.${reason}`;
}

function formatChangeType(changeType: AlphaRadarMemoChange['changeType']): string {
    switch (changeType) {
        case 'new':
            return 'opened a new position in';
        case 'exited':
            return 'exited';
        case 'increased':
            return 'increased';
        case 'decreased':
            return 'trimmed';
        case 'amended':
            return 'amended';
        case 'unchanged':
            return 'held';
    }
}
