/**
 * Settings between this browser and the server (launch item i37).
 *
 * Local first: every change goes into this browser's copy (per user, see
 * src/lib/storage/user-scope.ts) at once, marked pending, and is sent to
 * PUT /api/settings shortly after; the copy stops being pending once the
 * server has saved it. So a reload, a closed tab or a database outage never
 * loses an edit, and the next page load sends what the server missed.
 *
 * The copy remembers which server version (`updatedAt`) its edits were made
 * on, and every save names it: the server only accepts a save made on its
 * current version. When the server has moved on (another tab or device saved
 * since), the server's settings win and replace the ones here, so a stale
 * copy never reverts newer settings.
 *
 * A browser whose settings predate the server copy (including the shared
 * `atlas-settings` key from before per-user storage) sends them up once, the
 * first time the user has none stored. Without a database (local
 * development, E2E without one) the browser copy is all there is, as before.
 */

import { browserLocalStorage, readUserValue, removeUserValue, writeUserValue } from "@/lib/storage/user-scope";
import {
    PERSISTED_SETTINGS_SLICES,
    SETTINGS_VERSION,
    migrateSettings,
    normalizeSettings,
    persistedSettings,
    useSettingsStore,
    type SettingsState,
} from "@/lib/stores/settingsStore";

import type { ServerSettingsSnapshot, SettingsDocument, StoredSettingsDocument } from "./document";

/** The browser copy's key; the same one the persist middleware used. */
export const SETTINGS_STORAGE_KEY = "atlas-settings";

/** Browsers refuse keepalive requests with bodies over 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The browser copy, in the persist middleware's shape (`{ state, version }`)
 * so copies written before this change still read, plus `pending` while it
 * has edits the server hasn't saved and `baseUpdatedAt`, the server version
 * those edits were made on. A copy without the flag is `legacy`: the
 * middleware wrote it before settings had a server copy.
 */
export interface BrowserCopy {
    document: SettingsDocument;
    pending: boolean;
    legacy: boolean;
    baseUpdatedAt: string | null;
}

export function readBrowserCopy(storage: BrowserStorage | null, scope?: string): BrowserCopy | null {
    const raw = readUserValue(storage, SETTINGS_STORAGE_KEY, scope);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { state?: unknown; version?: unknown; pending?: unknown; baseUpdatedAt?: unknown };
        if (!parsed || typeof parsed.state !== "object" || parsed.state === null || Array.isArray(parsed.state)) return null;
        const version = typeof parsed.version === "number" && Number.isInteger(parsed.version) ? parsed.version : 0;
        return {
            document: { version, settings: parsed.state as SettingsDocument["settings"] },
            pending: parsed.pending === true,
            legacy: typeof parsed.pending !== "boolean",
            baseUpdatedAt: typeof parsed.baseUpdatedAt === "string" ? parsed.baseUpdatedAt : null,
        };
    } catch {
        return null;
    }
}

export function writeBrowserCopy(
    storage: BrowserStorage | null,
    document: SettingsDocument,
    { pending, baseUpdatedAt }: { pending: boolean; baseUpdatedAt: string | null },
): void {
    writeUserValue(storage, SETTINGS_STORAGE_KEY, JSON.stringify({
        state: document.settings,
        version: document.version,
        pending,
        baseUpdatedAt,
    }));
}

export function removeBrowserCopy(storage: BrowserStorage | null, scope?: string): void {
    removeUserValue(storage, SETTINGS_STORAGE_KEY, scope);
}

export interface StartPlan {
    /** What the store starts with; null keeps the defaults. */
    document: SettingsDocument | null;
    /** Send `document` to the server now. */
    push: boolean;
    /** The server version the started settings are based on. */
    baseUpdatedAt: string | null;
}

/** Which copy the page starts from, and whether the server needs it. */
export function planSettingsStart(server: ServerSettingsSnapshot, browser: BrowserCopy | null): StartPlan {
    if (server.status === "unavailable") {
        return { document: browser?.document ?? null, push: false, baseUpdatedAt: browser?.baseUpdatedAt ?? null };
    }
    const stored = server.document;
    if (stored) {
        // Edits made here on the server's current version win; once the
        // server has moved on, its settings do.
        if (browser?.pending && browser.baseUpdatedAt === stored.updatedAt) {
            return { document: browser.document, push: true, baseUpdatedAt: stored.updatedAt };
        }
        return { document: stored, push: false, baseUpdatedAt: stored.updatedAt };
    }
    // Nothing stored yet: this browser's settings (a legacy copy included)
    // become the user's.
    if (browser) return { document: browser.document, push: true, baseUpdatedAt: null };
    return { document: null, push: false, baseUpdatedAt: null };
}

/** The store's current settings as a document at the current version. */
export function currentSettingsDocument(state: SettingsState = useSettingsStore.getState()): SettingsDocument {
    return { version: SETTINGS_VERSION, settings: persistedSettings(state) };
}

/** Loads a document of any version, and of any shape, into the store. */
export function applySettingsDocument(document: SettingsDocument): void {
    // migrateSettings edits what it's given; never the caller's copy.
    const migrated = migrateSettings(structuredClone(document.settings), document.version);
    useSettingsStore.setState(normalizeSettings(migrated));
}

export function persistedSlicesChanged(next: SettingsState, previous: SettingsState): boolean {
    return PERSISTED_SETTINGS_SLICES.some((slice) => next[slice] !== previous[slice]);
}

export type SaveResult =
    | { status: "saved"; updatedAt: string }
    /** The server has moved on from the version the save was made on. */
    | { status: "conflict"; current: StoredSettingsDocument | null };

export type SendSettings = (
    document: SettingsDocument,
    options: { baseUpdatedAt: string | null; keepalive: boolean },
) => Promise<SaveResult>;

/** PUT /api/settings; throws when the server neither saved it nor reported a conflict. */
export const putSettings: SendSettings = async (document, { baseUpdatedAt, keepalive }) => {
    const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...document, baseUpdatedAt }),
        credentials: "same-origin",
        keepalive,
    });
    if (response.status === 409) {
        const body = (await response.json()) as { data?: { document?: StoredSettingsDocument | null } };
        return { status: "conflict", current: body.data?.document ?? null };
    }
    if (!response.ok) throw new Error(`Saving settings failed (${response.status})`);
    const body = (await response.json()) as { data: { updatedAt: string } };
    return { status: "saved", updatedAt: body.data.updatedAt };
};

export interface SettingsPusher {
    /** Sends `document` after `delayMs`, replacing anything still waiting. */
    schedule(document: SettingsDocument): void;
    /** Sends what's waiting now; resolves when the server has answered. */
    flush(): Promise<void>;
    /** Sends what's waiting with keepalive, for a page that is closing. */
    flushOnExit(): void;
    /** Whether a document is waiting or on its way. */
    busy(): boolean;
    /** The server version the next save will be made on. */
    base(): string | null;
    /** Moves to a newer server version the page learned of another way. */
    rebase(updatedAt: string | null): void;
    dispose(): void;
}

/**
 * Sends the latest document, one request at a time, each made on the last
 * server version it knows of. `onSaved` runs for every save that lands, with
 * `latest` false when a newer document is already waiting; `onConflict` when
 * the server has moved on, which drops whatever was waiting (the server's
 * settings win); `onFailed` when a save fails, which keeps it waiting for the
 * next change, flush or page load. A save sent as the page closes is handled
 * the same way once its answer arrives (a page restored from the
 * back-forward cache gets it then).
 */
export function createSettingsPusher({
    send,
    baseUpdatedAt,
    onSaved,
    onConflict,
    onFailed = () => {},
    delayMs = 500,
}: {
    send: SendSettings;
    baseUpdatedAt: string | null;
    onSaved: (document: SettingsDocument, updatedAt: string, latest: boolean) => void;
    onConflict: (current: StoredSettingsDocument | null) => void;
    onFailed?: (error: unknown) => void;
    delayMs?: number;
}): SettingsPusher {
    let base = baseUpdatedAt;
    let waiting: SettingsDocument | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;

    const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const sendNow = (document: SettingsDocument, keepalive: boolean): Promise<void> => {
        const request = send(document, { baseUpdatedAt: base, keepalive })
            .then((result) => {
                if (result.status === "saved") {
                    base = result.updatedAt;
                    onSaved(document, result.updatedAt, waiting === null);
                    return;
                }
                base = result.current?.updatedAt ?? null;
                waiting = null;
                clearTimer();
                onConflict(result.current);
            })
            .catch((error: unknown) => {
                // Keep it for the next attempt unless something newer came in.
                waiting ??= document;
                onFailed(error);
            })
            .finally(() => {
                if (inFlight === request) inFlight = null;
            });
        inFlight = request;
        return request;
    };

    const flush = async (): Promise<void> => {
        clearTimer();
        while (inFlight) await inFlight;
        const document = waiting;
        if (!document) return;
        waiting = null;
        await sendNow(document, false);
    };

    return {
        schedule(document) {
            waiting = document;
            clearTimer();
            timer = setTimeout(() => void flush(), delayMs);
        },
        flush,
        flushOnExit() {
            clearTimer();
            // One request at a time: a save on its way carries on, and the
            // next load sends whatever is still pending.
            if (!waiting || inFlight) return;
            // Too big for keepalive: the copy stays pending and the next
            // page load sends it.
            if (new TextEncoder().encode(JSON.stringify(waiting)).length > KEEPALIVE_MAX_BYTES) return;
            const document = waiting;
            waiting = null;
            void sendNow(document, true);
        },
        busy: () => waiting !== null || inFlight !== null,
        base: () => base,
        rebase(updatedAt) {
            base = updatedAt;
        },
        dispose: clearTimer,
    };
}

let activePusher: SettingsPusher | null = null;

/** For sign-out: waits for any unsaved settings to reach the server. */
export async function flushSettings(): Promise<void> {
    await activePusher?.flush();
}

/**
 * Starts the store from the right copy. Runs in the browser only: on the
 * server the store is shared by every request, so it keeps its defaults.
 */
export function startSettings(server: ServerSettingsSnapshot, storage: BrowserStorage | null = browserLocalStorage()): StartPlan {
    if (typeof window === "undefined") return { document: null, push: false, baseUpdatedAt: null };
    const plan = planSettingsStart(server, readBrowserCopy(storage));
    if (plan.document) applySettingsDocument(plan.document);
    return plan;
}

export interface SyncNotices {
    /** Another tab or device saved newer settings, which replaced these. */
    onReplaced?: () => void;
    /** A save to the server failed; the settings are kept here for later. */
    onSaveFailed?: () => void;
}

export interface SettingsSyncHandle {
    /**
     * Takes in a newer server snapshot (the root layout re-rendered, as
     * router.refresh() does): the page moves to its version, and to its
     * settings when nothing here is waiting to be saved.
     */
    rebase(server: ServerSettingsSnapshot): void;
    stop(): void;
}

/** A document saved by a newer version of the app, which this one can't save over. */
export function isNewerThanThisApp(document: SettingsDocument | null | undefined): boolean {
    return (document?.version ?? 0) > SETTINGS_VERSION;
}

/**
 * Keeps the browser copy and the server in step with the store from now on,
 * for as long as the page lives.
 */
export function syncSettings(
    server: ServerSettingsSnapshot,
    plan: StartPlan,
    {
        storage = browserLocalStorage(),
        send = putSettings,
        page = typeof window === "undefined" ? null : window,
        delayMs,
        notices = {},
    }: {
        storage?: BrowserStorage | null;
        send?: SendSettings;
        page?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
        delayMs?: number;
        notices?: SyncNotices;
    } = {},
): SettingsSyncHandle {
    // A newer app version wrote the stored settings (this one was rolled
    // back): show them, but never save over them with an older shape.
    let readOnly = server.status === "ok" && isNewerThanThisApp(server.document);
    const canSave = server.status === "ok";
    let applyingServerSettings = false;

    const takeServerSettings = (current: StoredSettingsDocument) => {
        applyingServerSettings = true;
        try {
            applySettingsDocument(current);
        } finally {
            applyingServerSettings = false;
        }
        writeBrowserCopy(storage, currentSettingsDocument(), { pending: false, baseUpdatedAt: current.updatedAt });
        if (isNewerThanThisApp(current)) readOnly = true;
    };

    const pusher = canSave
        ? createSettingsPusher({
            send,
            delayMs,
            baseUpdatedAt: plan.baseUpdatedAt,
            onSaved: (document, updatedAt, latest) => {
                // A newer edit waiting is still pending, now on this version.
                if (latest) writeBrowserCopy(storage, document, { pending: false, baseUpdatedAt: updatedAt });
                else writeBrowserCopy(storage, currentSettingsDocument(), { pending: true, baseUpdatedAt: updatedAt });
            },
            onConflict: (current) => {
                if (current) takeServerSettings(current);
                else writeBrowserCopy(storage, currentSettingsDocument(), { pending: false, baseUpdatedAt: null });
                notices.onReplaced?.();
            },
            onFailed: () => notices.onSaveFailed?.(),
        })
        : null;
    activePusher = pusher;

    if (plan.document && canSave && !readOnly) {
        // The copy now matches what the store started with, at the current
        // version; it stays pending until the server saves it.
        writeBrowserCopy(storage, currentSettingsDocument(), { pending: plan.push, baseUpdatedAt: plan.baseUpdatedAt });
    }
    if (plan.push && !readOnly) pusher?.schedule(currentSettingsDocument());

    const unsubscribe = useSettingsStore.subscribe((next, previous) => {
        if (applyingServerSettings || !persistedSlicesChanged(next, previous)) return;
        const document = currentSettingsDocument(next);
        writeBrowserCopy(storage, document, { pending: true, baseUpdatedAt: pusher?.base() ?? plan.baseUpdatedAt });
        if (!readOnly) pusher?.schedule(document);
    });
    const onPageHide = () => pusher?.flushOnExit();
    page?.addEventListener("pagehide", onPageHide);

    return {
        rebase(snapshot) {
            if (!pusher || snapshot.status !== "ok" || !snapshot.document) return;
            const current = snapshot.document;
            if (current.updatedAt === pusher.base()) return;
            // A save waiting or on its way settles it: the server takes it,
            // or answers with what it has.
            if (pusher.busy() || readBrowserCopy(storage)?.pending) return;
            pusher.rebase(current.updatedAt);
            takeServerSettings(current);
        },
        stop() {
            unsubscribe();
            page?.removeEventListener("pagehide", onPageHide);
            // Send anything still waiting rather than drop it with the timer.
            void pusher?.flush();
            if (activePusher === pusher) activePusher = null;
        },
    };
}
