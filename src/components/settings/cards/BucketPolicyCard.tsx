"use client";

import { useMemo } from "react";
import { Layers } from "lucide-react";
import {
    ASSIGNABLE_POLICY_BUCKETS,
    DEFAULT_BUCKET_POLICIES,
    POLICY_BUCKETS,
    POLICY_BUCKET_META,
    computeBucketAllocation,
    normalizeTicker,
    policyHoldings,
    withBucketChoice,
    type AssignablePolicyBucket,
    type PolicyBucketId,
    type PolicyBucketPolicy,
    type PolicyClassifiableHolding,
} from "@/lib/risk-policy";
import { usePolicyPortfolio } from "@/components/providers/PolicyPortfolioProvider";
import { useSettingsStore } from "@/lib/stores/settingsStore";

type BucketPolicyField = "targetPct" | "minPct" | "maxPct";

/** One ticker the user holds (in any account), with the bucket it starts in. */
interface HeldTicker {
    symbol: string;
    name: string;
    marketValue: number;
    defaultBucket: PolicyBucketId | null;
}

/**
 * Bucket policy (launch item i54): the targets and caps for each bucket,
 * and which bucket each of the user's holdings is in. A holding starts in
 * the bucket its type suggests (funds core, single stocks active ideas…)
 * until the user chooses one; the preview is their own portfolio.
 */
export function BucketPolicyCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const { portfolio, unavailable } = usePolicyPortfolio();
    const policies = riskPolicy.bucketPolicies;
    const assignments = riskPolicy.bucketAssignments;
    const policyByBucket = useMemo(
        () => new Map(policies.map((policy) => [policy.bucket, policy])),
        [policies],
    );
    // Cash counts as the cash reserve, as in the policy checks on Today.
    const holdings = useMemo<PolicyClassifiableHolding[]>(() => [
        ...policyHoldings(portfolio.holdings, riskPolicy),
        ...(portfolio.cashTotal > 0
            ? [{ id: "cash-reserve", symbol: "USD", name: "Cash", marketValue: portfolio.cashTotal, policyBucket: "cash_reserve" as const }]
            : []),
    ], [portfolio, riskPolicy]);
    const allocation = useMemo(
        () => computeBucketAllocation(holdings, policies),
        [holdings, policies],
    );
    const held = useMemo<HeldTicker[]>(() => {
        const bySymbol = new Map<string, HeldTicker>();
        for (const holding of portfolio.holdings) {
            const symbol = normalizeTicker(holding.symbol);
            const existing = bySymbol.get(symbol);
            if (existing) existing.marketValue += holding.marketValue;
            else bySymbol.set(symbol, { symbol, name: holding.name, marketValue: holding.marketValue, defaultBucket: holding.defaultBucket });
        }
        return [...bySymbol.values()].sort((a, b) => b.marketValue - a.marketValue);
    }, [portfolio.holdings]);

    const chooseBucket = (symbol: string, value: string) => {
        const bucket = (ASSIGNABLE_POLICY_BUCKETS as readonly string[]).includes(value)
            ? (value as AssignablePolicyBucket)
            : null;
        updateRiskPolicy({
            bucketAssignments: withBucketChoice(assignments, symbol, bucket, held.map((ticker) => ticker.symbol)),
        });
    };
    const rowByBucket = useMemo(
        () => new Map(allocation.rows.map((row) => [row.bucket, row])),
        [allocation.rows],
    );

    const updatePolicy = (
        bucket: PolicyBucketId,
        field: BucketPolicyField,
        rawValue: string,
    ) => {
        const value = rawValue === "" ? undefined : clampPct(Number(rawValue));
        const nextPolicies = POLICY_BUCKETS.map((candidate) => {
            const current = policyByBucket.get(candidate)
                ?? DEFAULT_BUCKET_POLICIES.find((policy) => policy.bucket === candidate)
                ?? { bucket: candidate };
            if (candidate !== bucket) return clonePolicy(current);
            return {
                ...clonePolicy(current),
                [field]: value,
            };
        });
        updateRiskPolicy({ bucketPolicies: normalizePolicies(nextPolicies) });
    };

    const resetDefaults = () => {
        updateRiskPolicy({
            bucketPolicies: DEFAULT_BUCKET_POLICIES.map((policy) => ({ ...policy })),
        });
    };

    const breached = allocation.rows.filter((row) => row.status === "breached").length;
    const missing = allocation.unassignedCount;

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-bucket-policy-head"
            data-testid="bucket-policy-card"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Layers className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-bucket-policy-head"
                        className="pm-settings-card-title"
                    >
                        Bucket policy
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    {breached} breached / {missing} unassigned
                </span>
            </header>

            <div className="pm-settings-card-body pm-bucket-card-body">
                <div className="pm-bucket-summary" aria-label="Bucket policy summary">
                    <div>
                        <span className="pm-cash-summary-label">Core</span>
                        <strong>{formatPct(rowByBucket.get("core")?.percentOfPortfolio ?? 0)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Active</span>
                        <strong>{formatPct(rowByBucket.get("active")?.percentOfPortfolio ?? 0)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Speculative</span>
                        <strong>{formatPct(rowByBucket.get("speculative")?.percentOfPortfolio ?? 0)}</strong>
                    </div>
                </div>

                <div className="pm-bucket-policy-list" role="list" aria-label="Bucket allocation policy">
                    {POLICY_BUCKETS.map((bucket) => {
                        const meta = POLICY_BUCKET_META[bucket];
                        const policy = policyByBucket.get(bucket)
                            ?? DEFAULT_BUCKET_POLICIES.find((candidate) => candidate.bucket === bucket)
                            ?? { bucket };
                        const row = rowByBucket.get(bucket);
                        return (
                            <article
                                key={bucket}
                                className="pm-bucket-policy-row"
                                role="listitem"
                                data-testid="bucket-policy-row"
                                data-bucket={bucket}
                                data-status={row?.status ?? "missing_data"}
                            >
                                <div className="pm-bucket-policy-main">
                                    <div className="pm-bucket-policy-titleline">
                                        <h3 className="pm-bucket-policy-title">{meta.label}</h3>
                                        <span className="pm-sell-pill" data-state={row?.status ?? "missing_data"}>
                                            {row?.status.replace("_", " ") ?? "missing data"}
                                        </span>
                                    </div>
                                    <p className="pm-bucket-policy-desc">{meta.description}</p>
                                    <p className="pm-bucket-policy-current">
                                        Current {formatPct(row?.percentOfPortfolio ?? 0)}
                                        {row && row.contributors.length > 0
                                            ? ` from ${row.contributors.slice(0, 3).map((item) => item.symbol).join(", ")}`
                                            : ""}
                                    </p>
                                </div>
                                <div className="pm-bucket-policy-inputs">
                                    <NumberField
                                        label={`${meta.label} target allocation`}
                                        value={policy.targetPct}
                                        onChange={(value) => updatePolicy(bucket, "targetPct", value)}
                                    />
                                    <NumberField
                                        label={`${meta.label} min allocation`}
                                        value={policy.minPct}
                                        onChange={(value) => updatePolicy(bucket, "minPct", value)}
                                    />
                                    <NumberField
                                        label={`${meta.label} max allocation`}
                                        value={policy.maxPct}
                                        onChange={(value) => updatePolicy(bucket, "maxPct", value)}
                                    />
                                </div>
                            </article>
                        );
                    })}
                </div>

                <section className="pm-bucket-holdings" aria-labelledby="pm-bucket-holdings-head" data-testid="bucket-holdings">
                    <h3 id="pm-bucket-holdings-head" className="pm-bucket-policy-title">Your holdings</h3>
                    {unavailable ? (
                        <p className="pm-churn-policy-note" data-testid="bucket-holdings-unavailable">
                            Your holdings couldn&apos;t be loaded, so there&apos;s nothing to sort into buckets right now.
                        </p>
                    ) : held.length === 0 ? (
                        <p className="pm-churn-policy-note" data-testid="bucket-holdings-empty">
                            Once an account has holdings, they&apos;re listed here and you choose the bucket each one is in.
                        </p>
                    ) : (
                        <>
                            <p className="pm-churn-policy-note">
                                Each holding starts in the bucket its type suggests: funds and bonds core, single stocks
                                active ideas, crypto and warrants speculative. Choose another where that&apos;s wrong.
                            </p>
                            <ul className="pm-bucket-holding-list" aria-label="Bucket for each holding">
                                {held.map((ticker) => {
                                    const total = allocation.totalMarketValue;
                                    return (
                                        <li
                                            key={ticker.symbol}
                                            className="pm-bucket-holding-row"
                                            data-testid="bucket-holding"
                                            data-symbol={ticker.symbol}
                                        >
                                            <span className="pm-bucket-holding-symbol">{ticker.symbol}</span>
                                            <span className="pm-bucket-holding-name">{ticker.name}</span>
                                            <span className="pm-bucket-holding-pct">
                                                {formatPct(total > 0 ? (ticker.marketValue / total) * 100 : 0)}
                                            </span>
                                            <select
                                                className="pm-settings-select"
                                                value={assignments[ticker.symbol] ?? ""}
                                                onChange={(event) => chooseBucket(ticker.symbol, event.target.value)}
                                                aria-label={`${ticker.symbol} bucket`}
                                            >
                                                <option value="">
                                                    {ticker.defaultBucket
                                                        ? `${POLICY_BUCKET_META[ticker.defaultBucket].label} (default)`
                                                        : "Unassigned"}
                                                </option>
                                                {ASSIGNABLE_POLICY_BUCKETS.map((bucket) => (
                                                    <option key={bucket} value={bucket}>
                                                        {POLICY_BUCKET_META[bucket].label}
                                                    </option>
                                                ))}
                                            </select>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                </section>

                <button
                    type="button"
                    className="pm-settings-card-cta pm-bucket-reset-button"
                    onClick={resetDefaults}
                >
                    Reset bucket policy
                </button>
            </div>
        </section>
    );
}

function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value?: number;
    onChange: (value: string) => void;
}) {
    return (
        <label className="pm-settings-field">
            <span className="pm-settings-field-label">
                {label.includes("target") ? "Target" : label.includes("min") ? "Min" : "Max"}
            </span>
            <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="pm-settings-input"
                value={value ?? ""}
                onChange={(event) => onChange(event.target.value)}
                aria-label={label}
            />
        </label>
    );
}

function normalizePolicies(policies: PolicyBucketPolicy[]): PolicyBucketPolicy[] {
    return policies.map((policy) => {
        const minPct = policy.minPct;
        const maxPct = policy.maxPct;
        return {
            ...policy,
            minPct: minPct != null && maxPct != null ? Math.min(minPct, maxPct) : minPct,
            maxPct,
        };
    });
}

function clonePolicy(policy: PolicyBucketPolicy): PolicyBucketPolicy {
    return { ...policy };
}

function clampPct(value: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPct(value: number): string {
    if (!Number.isFinite(value)) return "0%";
    return `${value.toFixed(value < 10 && value > 0 ? 1 : 0)}%`;
}
