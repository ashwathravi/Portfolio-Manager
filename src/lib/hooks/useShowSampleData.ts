"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_SHOW_SAMPLE_DATA, useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Whether example data shows before the page has mounted: the user's stored
 * setting, which the server knows (SettingsSync provides it), so the server
 * render and the first client paint agree without flashing examples at a
 * user who turned them off, or hiding them a moment from one who didn't.
 */
export const InitialShowSampleData = createContext<boolean>(DEFAULT_SHOW_SAMPLE_DATA);

/**
 * Whether example-data cards should render. Until after mount it's the
 * stored setting the page was rendered with; then it follows the store,
 * which a change in this tab, another tab or Settings updates.
 */
export function useShowSampleData(): boolean {
    const initial = useContext(InitialShowSampleData);
    const stored = useSettingsStore((s) => s.demo?.showSampleData ?? DEFAULT_SHOW_SAMPLE_DATA);
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);
    return mounted ? stored : initial;
}
