'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { ServerSettingsSnapshot } from '@/lib/settings/document';
import { startSettings, syncSettings, type SyncNotices } from '@/lib/settings/sync';

const NOTICES: SyncNotices = {
    onReplaced: () => toast.info('Your settings were changed in another tab or device. Showing the latest.'),
    onSaveFailed: () => toast.error("Couldn't save your settings to your account. They're kept in this browser and will be sent again.", {
        id: 'settings-save-failed',
    }),
};

/**
 * Starts the settings store from the user's stored settings and keeps the
 * browser copy and the server in step after that (src/lib/settings/sync.ts).
 * It sits above every component that reads settings, the ThemeProvider
 * included, and fills the store during its first render, before they read.
 */
export function SettingsSync({ server, children }: { server: ServerSettingsSnapshot; children: ReactNode }) {
    const [plan] = useState(() => startSettings(server));
    useEffect(() => syncSettings(server, plan, { notices: NOTICES }), [server, plan]);
    return children;
}
