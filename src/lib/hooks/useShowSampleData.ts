"use client";

import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Whether example-data cards should render. Returns the default (true)
 * until after mount so the server render and first client paint agree,
 * then follows the persisted preference.
 */
export function useShowSampleData(): boolean {
    const stored = useSettingsStore((s) => s.demo?.showSampleData ?? true);
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);
    return mounted ? stored : true;
}
