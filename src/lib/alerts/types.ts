/**
 * Domain types for threshold-based alerts. Alert rules are user-defined
 * conditions on price or portfolio state; triggers are the events emitted
 * when a rule fires.
 */

export type MarketAlertMetric =
    | 'price'           // raw quote price in the rule symbol's currency
    | 'price_change_pct' // daily % change vs previous close
    | 'portfolio_value'  // total portfolio market value
    | 'portfolio_day_change_pct'; // portfolio day change %

export type AlphaRadarAlertMetric =
    | 'alpha_radar_new_position'
    | 'alpha_radar_exit'
    | 'alpha_radar_large_add'
    | 'alpha_radar_large_trim'
    | 'alpha_radar_user_overlap';

export type AlertMetric = MarketAlertMetric | AlphaRadarAlertMetric;

export type AlertSource = 'market' | 'alpha_radar';

export type AlertComparator = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

export interface AlertRule {
    id: string;
    /** Human-readable name for the rule. */
    name: string;
    metric: AlertMetric;
    /**
     * For price / price_change_pct rules this is the ticker symbol to watch.
     * For portfolio_* rules this is ignored.
     */
    symbol?: string;
    comparator: AlertComparator;
    /**
     * Threshold expressed in the same units as the metric:
     *   - price: absolute price (e.g. 150.00)
     *   - *_pct: fraction (0.05 = 5%)
     *   - portfolio_value: absolute dollar amount
     */
    threshold: number;
    /** When false, the rule is paused and won't fire. */
    enabled: boolean;
    /**
     * Rearm policy. 'once' fires once and then disables itself. 'always'
     * keeps firing while the condition holds (caller is responsible for
     * de-duping on timestamp). 'daily' fires at most once per calendar day.
     */
    rearm: 'once' | 'always' | 'daily';
    /** Optional free-text note shown with the notification. */
    note?: string;
    /** Optional source discriminator. Older persisted market rules omit it. */
    source?: AlertSource;
    /** ISO timestamp when the rule was created. */
    createdAt: string;
    /** ISO timestamp of the most recent trigger, if any. */
    lastTriggeredAt?: string;
}

export interface AlphaRadarAlertContext {
    trackedFilerId: string;
    filerName: string;
    reportId?: string;
    reportPeriod: string;
    filingId?: string;
    issuerName: string;
    ticker?: string;
    cusip: string;
    changeType: string;
    materialityScore: number;
    relevanceReasons: string[];
}

export interface AlertTrigger {
    id: string;
    ruleId: string;
    ruleName: string;
    metric: AlertMetric;
    symbol?: string;
    comparator: AlertComparator;
    threshold: number;
    /** The observed metric value at trigger time. */
    observedValue: number;
    /** ISO timestamp when the trigger fired. */
    triggeredAt: string;
    /** Whether the user has dismissed the trigger from the inbox. */
    acknowledged: boolean;
    /** Optional source discriminator. Older triggers omit it. */
    source?: AlertSource;
    /** User-facing notification copy. */
    message?: string;
    /** Destination for the source object that produced this alert. */
    href?: string;
    /** Source metadata for richer notification rendering and tests. */
    alphaRadar?: AlphaRadarAlertContext;
}

export interface MarketSnapshot {
    /** Current prices by symbol (uppercased). */
    quotes: Record<string, { price: number; changePercent: number }>;
    /** Total portfolio market value in base currency. */
    portfolioValue: number;
    /** Portfolio day change as a fraction (0.012 = +1.2%). */
    portfolioDayChangePct: number;
    /** Timestamp the snapshot was captured. */
    observedAt: string;
}
