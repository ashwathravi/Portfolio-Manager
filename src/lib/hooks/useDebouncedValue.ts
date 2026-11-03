'use client';

import { useEffect, useState } from 'react';

/** `value` once it has stayed the same for `delayMs`; search-as-you-type waits for a pause. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(id);
    }, [value, delayMs]);
    return debounced;
}
