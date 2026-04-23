"use client";

import { type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Coins, Banknote } from "lucide-react";

/**
 * Phase 3 (AR-72) Activity feed card.
 *
 * Typed rows for the four transaction kinds we render on the Dashboard:
 * buy, sell, dividend, deposit. Each row is an icon tile (color-coded per
 * type), a headline + meta stack in the middle, and a mono amount on the
 * right. Withdrawal is handled as a red deposit for signage.
 *
 * The spec asks for "last 30 days" — the caller does that filter, we just
 * render what's passed in.
 */

export type ActivityType =
    | "buy"
    | "sell"
    | "dividend"
    | "deposit"
    | "withdrawal";

export interface ActivityRow {
    id: string;
    type: ActivityType;
    date: string; // already pre-formatted by the caller (e.g., "Apr 22")
    ticker?: string;
    quantity?: number;
    amount: number;
    notes?: string;
}

export interface RecentActivityCardProps {
    activities: ActivityRow[];
    /** Max rows to render. Default 8. */
    limit?: number;
    className?: string;
}

export function RecentActivityCard({
    activities,
    limit = 8,
    className,
}: RecentActivityCardProps) {
    const trimmed = activities.slice(0, limit);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Recent activity"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Recent Activity</h3>
                    <p className="pm-card-subtitle">
                        Last {trimmed.length} {trimmed.length === 1 ? "event" : "events"}
                    </p>
                </div>
            </header>

            {trimmed.length === 0 ? (
                <p className="pm-card-subtitle" style={{ padding: "8px 0" }}>
                    No recent activity.
                </p>
            ) : (
                <ul className="pm-activity-list">
                    {trimmed.map((a) => (
                        <ActivityRowView key={a.id} activity={a} />
                    ))}
                </ul>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ActivityRowView({ activity }: { activity: ActivityRow }) {
    const spec = SPECS[activity.type];
    const headline = buildHeadline(activity, spec.headlineVerb);
    const amountClass = spec.amountColor
        ? `pm-activity-amount ${spec.amountColor}`
        : "pm-activity-amount";
    return (
        <li className="pm-activity-row">
            <span className={`pm-activity-icon ${spec.iconClass}`} aria-hidden="true">
                {spec.icon}
            </span>
            <div className="pm-activity-text">
                <span className="pm-activity-headline">{headline}</span>
                <span className="pm-activity-meta">
                    {activity.date}
                    {activity.notes ? ` · ${activity.notes}` : ""}
                </span>
            </div>
            <span className={amountClass}>
                {spec.amountSign}
                {fmtCurrency(Math.abs(activity.amount))}
            </span>
        </li>
    );
}

// ---------------------------------------------------------------------------
// Type → styling spec
// ---------------------------------------------------------------------------

interface TypeSpec {
    icon: ReactNode;
    iconClass: string;
    headlineVerb: string;
    amountSign: "+" | "−" | "";
    amountColor?: string;
}

const SPECS: Record<ActivityType, TypeSpec> = {
    buy: {
        icon: <ArrowDownLeft size={14} aria-hidden="true" />,
        iconClass: "pm-activity-icon-buy",
        headlineVerb: "Bought",
        amountSign: "−",
        amountColor: "pm-activity-amount-neg",
    },
    sell: {
        icon: <ArrowUpRight size={14} aria-hidden="true" />,
        iconClass: "pm-activity-icon-sell",
        headlineVerb: "Sold",
        amountSign: "+",
        amountColor: "pm-activity-amount-pos",
    },
    dividend: {
        icon: <Coins size={14} aria-hidden="true" />,
        iconClass: "pm-activity-icon-dividend",
        headlineVerb: "Dividend",
        amountSign: "+",
        amountColor: "pm-activity-amount-pos",
    },
    deposit: {
        icon: <Banknote size={14} aria-hidden="true" />,
        iconClass: "pm-activity-icon-deposit",
        headlineVerb: "Deposit",
        amountSign: "+",
        amountColor: "pm-activity-amount-pos",
    },
    withdrawal: {
        icon: <Banknote size={14} aria-hidden="true" />,
        iconClass: "pm-activity-icon-deposit",
        headlineVerb: "Withdrawal",
        amountSign: "−",
        amountColor: "pm-activity-amount-neg",
    },
};

function buildHeadline(a: ActivityRow, verb: string): string {
    if (a.ticker && a.quantity != null) {
        return `${verb} ${fmtQty(a.quantity)} ${a.ticker}`;
    }
    if (a.ticker) return `${verb} ${a.ticker}`;
    return verb;
}

function fmtCurrency(n: number): string {
    return `$${n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtQty(q: number): string {
    if (Number.isInteger(q)) return String(q);
    return q.toFixed(2);
}
