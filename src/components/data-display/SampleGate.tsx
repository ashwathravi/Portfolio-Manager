"use client";

import type { ReactNode } from "react";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";

/**
 * Renders example-data content only while "Show example data" is on
 * (Settings › Data). `fallback` renders instead when it is off — usually
 * an empty state that explains how to get real data in.
 */
export function SampleGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
    const show = useShowSampleData();
    return <>{show ? children : fallback}</>;
}
