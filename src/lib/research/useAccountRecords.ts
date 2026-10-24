'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WriteOrder } from '@/lib/validators/research-ids';
import { createAccountWriter, type AccountWriter } from './accountWrites';

/**
 * Research data kept in the user's account (launch item i38): the stored
 * records from one query, and this page's unsaved writes to show on top.
 * Writes are sent one record at a time, latest wins, each numbered in this
 * page's order; a saved write is applied to the query's data, and a failed
 * one is undone with a toast and the data read again.
 */
export interface AccountRecordsOptions<Stored, W extends object> {
    /** One user per page load (signing in or out reloads), so no user in the key. */
    queryKey: readonly string[];
    enabled: boolean;
    load: () => Promise<Stored>;
    send: (id: string, write: W, order: WriteOrder) => Promise<void>;
    apply: (stored: Stored | undefined, id: string, write: W) => Stored;
    failedMessage: (write: W, error: unknown) => string;
    loadFailedMessage: string;
}

const writers = new WeakMap<QueryClient, Map<string, AccountWriter<object>>>();

/**
 * The writer for `options.queryKey` on this query client, made once and
 * shared by every component that shows those records. A saved write is
 * applied to the query's data (and the data read again if a read that may
 * not include it is in flight); a failed one is reported with `notify` and
 * the data read again.
 */
export function accountWriterFor<Stored, W extends object>(
    queryClient: QueryClient,
    options: Pick<AccountRecordsOptions<Stored, W>, 'queryKey' | 'send' | 'apply' | 'failedMessage'>,
    notify: (message: string) => void = (message) => { toast.error(message); },
): AccountWriter<W> {
    let byKey = writers.get(queryClient);
    if (!byKey) {
        byKey = new Map();
        writers.set(queryClient, byKey);
    }
    const name = JSON.stringify(options.queryKey);
    const existing = byKey.get(name);
    if (existing) return existing as unknown as AccountWriter<W>;

    const { queryKey } = options;
    const writer = createAccountWriter<W>({
        send: options.send,
        onSaved: (id, write) => {
            if (queryClient.getQueryData(queryKey)) {
                queryClient.setQueryData<Stored>(queryKey, (stored) => options.apply(stored, id, write));
            }
            // A read that started before this save may not include it: read again.
            if (queryClient.isFetching({ queryKey }) > 0) void queryClient.invalidateQueries({ queryKey });
        },
        onFailed: (_id, write, error) => {
            notify(options.failedMessage(write, error));
            // The change is undone; show what the account has.
            void queryClient.invalidateQueries({ queryKey });
        },
    });
    byKey.set(name, writer as unknown as AccountWriter<object>);
    // A reload or close shouldn't drop an edit queued behind another.
    if (typeof window !== 'undefined') window.addEventListener('pagehide', writer.sendWaiting);
    return writer;
}

const NO_WRITES: ReadonlyMap<string, unknown> = new Map();

export function useAccountRecords<Stored, W extends object>(options: AccountRecordsOptions<Stored, W>) {
    const queryClient = useQueryClient();
    const writer = accountWriterFor(queryClient, options);
    const query = useQuery({
        queryKey: options.queryKey,
        queryFn: options.load,
        enabled: options.enabled,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });
    const pending = useSyncExternalStore(writer.subscribe, writer.pending, () => NO_WRITES as ReadonlyMap<string, W>);

    const { enabled, loadFailedMessage } = options;
    const failed = enabled && query.isError;
    useEffect(() => {
        if (failed) toast.error(loadFailedMessage, { id: loadFailedMessage });
    }, [failed, loadFailedMessage]);

    return { data: query.data, pending, write: writer.write, loaded: query.isSuccess, failed: query.isError };
}
