"use client";

import { useMemo } from "react";
import { ActiveThesesCard } from "@/components/dashboard/ActiveThesesCard";
import { useThesisStore } from "@/lib/research/useThesisStore";
import { toTodayTheses } from "@/lib/today/rows";

/**
 * Active theses on Today, read from the same research store as the
 * Research workspace (the old card rendered its own hardcoded list that
 * disagreed with Research).
 */
export function TodayTheses({ limit = 4 }: { limit?: number }) {
    const { theses } = useThesisStore();
    const rows = useMemo(() => toTodayTheses(theses), [theses]);
    return <ActiveThesesCard rows={rows} limit={limit} />;
}
