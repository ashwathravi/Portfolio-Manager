'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { ServerSettingsSnapshot } from '@/lib/settings/document';
import { startSettings, syncSettings } from '@/lib/settings/sync';

/**
 * Starts the settings store from the user's stored settings and keeps the
 * browser copy and the server in step after that (src/lib/settings/sync.ts).
 * It sits above every component that reads settings, the ThemeProvider
 * included, and fills the store during its first render, before they read.
 */
export function SettingsSync({ server, children }: { server: ServerSettingsSnapshot; children: ReactNode }) {
    const [plan] = useState(() => startSettings(server));
    useEffect(() => syncSettings(server, plan), [server, plan]);
    return children;
}
