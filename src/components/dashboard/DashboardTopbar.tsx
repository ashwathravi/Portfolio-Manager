"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Phase 3 (AR-71) Dashboard topbar.
 *
 * Layout:
 *
 *     Home / Dashboard                       [Reconcile] [+ New order]
 *     Good morning, Ashwath
 *     Tuesday · Markets open · Updated 14s ago
 *
 * Rendering strategy:
 *   - The parent page is a server component and doesn't know the viewer's
 *     first name, so we read it from the persisted Zustand settings store
 *     ("use client").
 *   - Time-of-day greeting is computed on the client too — if the server
 *     computed it we'd flash "good morning" at midnight-UTC users.
 *   - "Updated Ns ago" is optional (`lastUpdatedAt`); the equity card is
 *     the authoritative source for the market-data ticker, not the topbar.
 */

export interface DashboardTopbarProps {
    /** Market-state text shown in the subtitle. e.g. "Markets open". */
    marketStateLabel?: string;
    /** Epoch-ms the live-quote layer last refreshed. Renders "Updated Ns ago". */
    lastUpdatedAt?: number | null;
    /** Primary action href; defaults to /portfolios. */
    newOrderHref?: string;
    /** Secondary action href; defaults to /portfolios/holdings. */
    reconcileHref?: string;
}

export function DashboardTopbar({
    marketStateLabel = "Markets open",
    lastUpdatedAt,
    newOrderHref = "/portfolios",
    reconcileHref = "/portfolios/holdings",
}: DashboardTopbarProps) {
    const fullName = useSettingsStore((s) => s.profile.fullName);
    const firstName = (fullName?.split(" ")[0] ?? fullName) || "there";

    const greeting = useTimeOfDayGreeting();
    const dayLabel = useWeekdayLabel();
    const updated = useRelativeUpdated(lastUpdatedAt);

    return (
        <header className="pm-dashboard-topbar">
            <div>
                <nav className="pm-crumbs" aria-label="Breadcrumb">
                    <Link href="/">Home</Link>
                    <span className="pm-crumbs-sep">/</span>
                    <span aria-current="page">Dashboard</span>
                </nav>
                <h1 className="pm-greeting">Good {greeting}, {firstName}</h1>
                <p className="pm-greeting-sub">
                    {dayLabel} · {marketStateLabel}
                    {updated ? ` · ${updated}` : ""}
                </p>
            </div>

            <div className="pm-topbar-actions">
                <Link href={reconcileHref} className="pm-btn pm-btn-ghost">
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Reconcile</span>
                </Link>
                <Link href={newOrderHref} className="pm-btn pm-btn-primary">
                    <Plus size={14} aria-hidden="true" />
                    <span>New order</span>
                </Link>
            </div>
        </header>
    );
}

// ---------------------------------------------------------------------------
// Hooks — kept inside the file so the topbar is a single import.
// ---------------------------------------------------------------------------

/**
 * Returns "morning" / "afternoon" / "evening" based on the local hour.
 * Computed on mount + recomputed every 10 minutes so a user who leaves the
 * tab open across a boundary sees the right label after hydration.
 */
function useTimeOfDayGreeting(): string {
    const [greeting, setGreeting] = useState<string>(() => computeGreeting());
    useEffect(() => {
        const id = setInterval(() => setGreeting(computeGreeting()), 10 * 60 * 1000);
        return () => clearInterval(id);
    }, []);
    return greeting;
}

function computeGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 18) return "afternoon";
    return "evening";
}

/** Renders "Tuesday" / "Friday" etc. Recomputes at midnight for kept-open tabs. */
function useWeekdayLabel(): string {
    const [label, setLabel] = useState<string>(() => computeWeekday());
    useEffect(() => {
        // Align to next midnight, then every 24h.
        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 5, 0); // 5s past midnight for safety
        const initialDelay = Math.max(0, nextMidnight.getTime() - now.getTime());
        const timer = setTimeout(function tick() {
            setLabel(computeWeekday());
            // After the first alignment, tick every 24h.
            setTimeout(tick, 24 * 60 * 60 * 1000);
        }, initialDelay);
        return () => clearTimeout(timer);
    }, []);
    return label;
}

function computeWeekday(): string {
    return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

/**
 * Returns a relative-time string for the last refresh, e.g. "Updated 14s ago",
 * or null when no timestamp was passed. Refreshes every second.
 */
function useRelativeUpdated(updatedAt: number | null | undefined): string | null {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (updatedAt == null) return;
        const id = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [updatedAt]);

    if (updatedAt == null) return null;

    // tick is only used to retrigger; the real computation reads the clock.
    void tick;
    const ageMs = Date.now() - updatedAt;
    const ageS = Math.max(0, Math.round(ageMs / 1000));
    if (ageS < 5) return "Updated just now";
    if (ageS < 60) return `Updated ${ageS}s ago`;
    const ageM = Math.round(ageS / 60);
    if (ageM < 60) return `Updated ${ageM}m ago`;
    const ageH = Math.round(ageM / 60);
    return `Updated ${ageH}h ago`;
}
