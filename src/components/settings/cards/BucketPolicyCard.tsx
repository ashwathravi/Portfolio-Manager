"use client";

import { useMemo } from "react";
import { Layers } from "lucide-react";
import {
    DEFAULT_BUCKET_POLICIES,
    POLICY_BUCKETS,
    POLICY_BUCKET_META,
    computeBucketAllocation,
    type PolicyBucketId,
    type PolicyBucketPolicy,
} from "@/lib/risk-policy";
import { mockPortfolios } from "@/lib/mockData";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const SAMPLE_HOLDINGS = (mockPortfolios[0]?.holdings ?? []).map((holding) => ({
    id: holding.id,
    symbol: holding.ticker,
    name: holding.name,
    marketValue: holding.marketValue,
    policyBucket: holding.policyBucket,
}));

type BucketPolicyField = "targetPct" | "minPct" | "maxPct";

export function BucketPolicyCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const policies = riskPolicy.bucketPolicies;
    const policyByBucket = useMemo(
        () => new Map(policies.map((policy) => [policy.bucket, policy])),
        [policies],
    );
    const allocation = useMemo(
        () => computeBucketAllocation(SAMPLE_HOLDINGS, policies),
        [policies],
    );
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
