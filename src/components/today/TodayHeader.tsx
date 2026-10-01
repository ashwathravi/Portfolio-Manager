"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { useDisplayName } from "@/components/providers/IdentityProvider";
import { marketStateLabel } from "@/lib/markets/market-hours";

function greetingFor(hour: number): string {
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

/**
 * The single Today header (title "Today" in the shared top bar). Replaces
 * the old two-header stack (top bar "Dashboard" + in-page greeting block).
 * Greeting, weekday, and market state are computed after mount so the
 * server render and hydration agree.
 */
export function TodayHeader() {
    const { firstName } = useDisplayName();
    const [now, setNow] = useState<Date | null>(null);

    useEffect(() => {
        const tick = () => setNow(new Date());
        const first = setTimeout(tick, 0);
        const id = setInterval(tick, 60_000);
        return () => {
            clearTimeout(first);
            clearInterval(id);
        };
    }, []);

    const subtitle = now
        ? [
              `${greetingFor(now.getHours())}${firstName ? `, ${firstName}` : ""}`,
              now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
              marketStateLabel(now),
          ].join(" · ")
        : undefined;

    const actions = useMemo(
        () => (
            <Link href="/execution" className="pm-btn pm-btn-primary">
                <Plus size={14} aria-hidden="true" />
                <span>New order</span>
            </Link>
        ),
        [],
    );

    usePageHeader({ title: "Today", subtitle, crumbs: ["Today"], actions });
    return null;
}
