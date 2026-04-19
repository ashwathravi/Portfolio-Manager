import type {
    AlertComparator,
    AlertRule,
    AlertTrigger,
    MarketSnapshot,
} from './types';

/**
 * Returns true if `value` satisfies the given comparator against `threshold`.
 * Equality uses a small epsilon so floating-point drift doesn't suppress
 * legitimate '=' rules on prices.
 */
export function compare(value: number, comparator: AlertComparator, threshold: number): boolean {
    const EQ_EPSILON = 1e-6;
    switch (comparator) {
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'gt':  return value > threshold;
        case 'lt':  return value < threshold;
        case 'eq':  return Math.abs(value - threshold) < EQ_EPSILON;
    }
}

/**
 * Extracts the observed metric value for a rule from the snapshot, or
 * returns null if the snapshot lacks the data needed to evaluate the rule.
 */
export function observeMetric(rule: AlertRule, snapshot: MarketSnapshot): number | null {
    switch (rule.metric) {
        case 'price': {
            if (!rule.symbol) return null;
            const quote = snapshot.quotes[rule.symbol.toUpperCase()];
            return quote ? quote.price : null;
        }
        case 'price_change_pct': {
            if (!rule.symbol) return null;
            const quote = snapshot.quotes[rule.symbol.toUpperCase()];
            return quote ? quote.changePercent : null;
        }
        case 'portfolio_value':
            return snapshot.portfolioValue;
        case 'portfolio_day_change_pct':
            return snapshot.portfolioDayChangePct;
    }
}

/**
 * Decides whether a rule's rearm policy permits it to fire given its last
 * trigger timestamp and the current snapshot time.
 */
export function canFire(rule: AlertRule, snapshot: MarketSnapshot): boolean {
    if (!rule.enabled) return false;
    if (!rule.lastTriggeredAt) return true;
    switch (rule.rearm) {
        case 'once':
            return false;
        case 'always':
            return true;
        case 'daily': {
            const last = new Date(rule.lastTriggeredAt);
            const now = new Date(snapshot.observedAt);
            return (
                last.getUTCFullYear() !== now.getUTCFullYear() ||
                last.getUTCMonth() !== now.getUTCMonth() ||
                last.getUTCDate() !== now.getUTCDate()
            );
        }
    }
}

/**
 * Pure evaluator. Given a set of rules and a market snapshot, returns the
 * triggers that should fire *right now*. Callers own the side effects of
 * persisting triggers and updating rule `lastTriggeredAt` / auto-disabling
 * 'once' rules.
 */
export function evaluateAlerts(
    rules: readonly AlertRule[],
    snapshot: MarketSnapshot,
): AlertTrigger[] {
    const triggers: AlertTrigger[] = [];
    for (const rule of rules) {
        if (!canFire(rule, snapshot)) continue;
        const observed = observeMetric(rule, snapshot);
        if (observed === null) continue;
        if (!compare(observed, rule.comparator, rule.threshold)) continue;
        triggers.push({
            id: makeTriggerId(rule.id, snapshot.observedAt),
            ruleId: rule.id,
            ruleName: rule.name,
            metric: rule.metric,
            symbol: rule.symbol,
            comparator: rule.comparator,
            threshold: rule.threshold,
            observedValue: observed,
            triggeredAt: snapshot.observedAt,
            acknowledged: false,
        });
    }
    return triggers;
}

function makeTriggerId(ruleId: string, timestamp: string): string {
    return `${ruleId}-${timestamp}`;
}

// --------------------------------------------------------------------------
// UI helpers
// --------------------------------------------------------------------------

const COMPARATOR_LABELS: Record<AlertComparator, string> = {
    gte: '≥',
    lte: '≤',
    gt: '>',
    lt: '<',
    eq: '=',
};

const METRIC_LABELS: Record<AlertRule['metric'], string> = {
    price: 'Price',
    price_change_pct: 'Daily % change',
    portfolio_value: 'Portfolio value',
    portfolio_day_change_pct: 'Portfolio day change',
};

export function describeRule(rule: Pick<AlertRule, 'metric' | 'symbol' | 'comparator' | 'threshold'>): string {
    const metric = METRIC_LABELS[rule.metric];
    const cmp = COMPARATOR_LABELS[rule.comparator];
    const subject = rule.symbol ? `${rule.symbol.toUpperCase()} ${metric.toLowerCase()}` : metric;
    const threshold = formatThreshold(rule.metric, rule.threshold);
    return `${subject} ${cmp} ${threshold}`;
}

function formatThreshold(metric: AlertRule['metric'], value: number): string {
    if (metric === 'price' || metric === 'portfolio_value') {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const sign = value > 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
}
