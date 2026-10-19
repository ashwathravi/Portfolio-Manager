'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { ServerSettingsSnapshot } from '@/lib/settings/document';
import { startSettings, syncSettings, type SettingsSyncHandle, type SyncNotices } from '@/lib/settings/sync';

const NOTICES: SyncNotices = {
    onReplaced: () => toast.info('Your settings were changed in another tab or device. Showing the latest.'),
    onSaveFailed: () => toast.error("Couldn't save your settings to your account. They're kept in this browser and will be sent again.", {
        id: 'settings-save-failed',
    }),
    onReadOnly: () => toast.warning("These settings were saved by a newer version of Atlas Wealth, so changes made here won't be kept. Reload to get the latest version."),
};

/**
 * Starts the settings store from the user's stored settings and keeps the
 * browser copy and the server in step after that (src/lib/settings/sync.ts).
 * It sits above every component that reads settings, the ThemeProvider
 * included, and fills the store during its first render, before they read.
 * One sync runs for the life of the page; a re-rendered layout
 * (router.refresh()) hands it the newer server snapshot.
 */
export function SettingsSync({ server, children }: { server: ServerSettingsSnapshot; children: ReactNode }) {
    const [start] = useState(() => ({ server, plan: startSettings(server) }));
    const sync = useRef<SettingsSyncHandle | null>(null);

    useEffect(() => {
        const handle = syncSettings(start.server, start.plan, { notices: NOTICES });
        sync.current = handle;
        return () => {
            handle.stop();
            sync.current = null;
        };
    }, [start]);

    useEffect(() => {
        if (server !== start.server) sync.current?.rebase(server);
    }, [server, start]);

    return children;
}
