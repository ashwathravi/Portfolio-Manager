/**
 * Settings between this browser and the server (launch item i37).
 *
 * Local first: every change goes into this browser's copy (per user, see
 * src/lib/storage/user-scope.ts) at once, marked pending, and is sent to
 * PUT /api/settings shortly after; the copy stops being pending once the
 * server has saved it. So a reload, a closed tab or a database outage never
 * loses an edit, and the next page load sends what the server missed.
 *
 * When a page loads, the server's document wins unless this browser has
 * edits the server never saved. A browser whose settings predate the server
 * copy (including the shared `atlas-settings` key from before per-user
 * storage) sends them up once, the first time the user has none stored.
 * Without a database (local development, E2E without one) the browser copy
 * is all there is, as before.
 */

import { browserLocalStorage, readUserValue, removeUserValue, writeUserValue } from "@/lib/storage/user-scope";
import {
    PERSISTED_SETTINGS_SLICES,
    SETTINGS_VERSION,
    migrateSettings,
    persistedSettings,
    useSettingsStore,
    type SettingsState,
} from "@/lib/stores/settingsStore";

import type { ServerSettingsSnapshot, SettingsDocument } from "./document";

/** The browser copy's key; the same one the persist middleware used. */
export const SETTINGS_STORAGE_KEY = "atlas-settings";

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The browser copy, in the persist middleware's shape (`{ state, version }`)
 * so copies written before this change still read, plus `pending` while it
 * has edits the server hasn't saved. A copy without the flag is `legacy`:
 * the middleware wrote it before settings had a server copy.
 */
export interface BrowserCopy {
    document: SettingsDocument;
    pending: boolean;
    legacy: boolean;
}

export function readBrowserCopy(storage: BrowserStorage | null, scope?: string): BrowserCopy | null {
    const raw = readUserValue(storage, SETTINGS_STORAGE_KEY, scope);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { state?: unknown; version?: unknown; pending?: unknown };
        if (!parsed || typeof parsed.state !== "object" || parsed.state === null || Array.isArray(parsed.state)) return null;
        const version = typeof parsed.version === "number" && Number.isInteger(parsed.version) ? parsed.version : 0;
        return {
            document: { version, settings: parsed.state as SettingsDocument["settings"] },
            pending: parsed.pending === true,
            legacy: typeof parsed.pending !== "boolean",
        };
    } catch {
        return null;
    }
}

export function writeBrowserCopy(storage: BrowserStorage | null, document: SettingsDocument, pending: boolean): void {
    writeUserValue(storage, SETTINGS_STORAGE_KEY, JSON.stringify({ state: document.settings, version: document.version, pending }));
}

export function removeBrowserCopy(storage: BrowserStorage | null, scope?: string): void {
    removeUserValue(storage, SETTINGS_STORAGE_KEY, scope);
}

export interface StartPlan {
    /** What the store starts with; null keeps the defaults. */
    document: SettingsDocument | null;
    /** Send `document` to the server now. */
    push: boolean;
}

/** Which copy the page starts from, and whether the server needs it. */
export function planSettingsStart(server: ServerSettingsSnapshot, browser: BrowserCopy | null): StartPlan {
    if (server.status === "unavailable") return { document: browser?.document ?? null, push: false };
    // Edits made here that the server never saved win over its copy.
    if (browser?.pending) return { document: browser.document, push: true };
    if (server.document) return { document: server.document, push: false };
    // Nothing stored yet: this browser's settings (a legacy copy included)
    // become the user's.
    if (browser) return { document: browser.document, push: true };
    return { document: null, push: false };
}

/** The store's current settings as a document at the current version. */
export function currentSettingsDocument(state: SettingsState = useSettingsStore.getState()): SettingsDocument {
    return { version: SETTINGS_VERSION, settings: persistedSettings(state) };
}

/** Loads a document of any version into the store. */
export function applySettingsDocument(document: SettingsDocument): void {
    // migrateSettings edits what it's given; never the caller's copy.
    const migrated = migrateSettings(structuredClone(document.settings), document.version);
    useSettingsStore.setState(migrated);
}

export function persistedSlicesChanged(next: SettingsState, previous: SettingsState): boolean {
    return PERSISTED_SETTINGS_SLICES.some((slice) => next[slice] !== previous[slice]);
}

export type SendSettings = (document: SettingsDocument, options: { keepalive: boolean }) => Promise<void>;

/** PUT /api/settings; throws when the server didn't save it. */
export const putSettings: SendSettings = async (document, { keepalive }) => {
    const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
        credentials: "same-origin",
        keepalive,
    });
    if (!response.ok) throw new Error(`Saving settings failed (${response.status})`);
};

export interface SettingsPusher {
    /** Sends `document` after `delayMs`, replacing anything still waiting. */
    schedule(document: SettingsDocument): void;
    /** Sends what's waiting now; resolves when the server has answered. */
    flush(): Promise<void>;
    /** Sends what's waiting with keepalive, for a page that is closing. */
    flushOnExit(): void;
    dispose(): void;
}

/**
 * Sends the latest document, one request at a time. `onSaved` runs when the
 * server has saved a document and nothing newer is waiting, which is when the
 * browser copy stops being pending. A failed save stays waiting for the next
 * change, flush or page load.
 */
export function createSettingsPusher({
    send,
    onSaved,
    delayMs = 500,
}: {
    send: SendSettings;
    onSaved: (document: SettingsDocument) => void;
    delayMs?: number;
}): SettingsPusher {
    let waiting: SettingsDocument | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;

    const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const flush = async (): Promise<void> => {
        clearTimer();
        if (inFlight) await inFlight;
        const document = waiting;
        if (!document) return;
        waiting = null;
        inFlight = send(document, { keepalive: false })
            .then(() => {
                if (!waiting) onSaved(document);
            })
            .catch(() => {
                // Keep it for the next attempt unless something newer came in.
                waiting ??= document;
            })
            .finally(() => {
                inFlight = null;
            });
        await inFlight;
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
            if (!waiting) return;
            // The page may be gone before an answer arrives; the copy stays
            // pending, and the next load sends it again if this one failed.
            void send(waiting, { keepalive: true }).catch(() => {});
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
    if (typeof window === "undefined") return { document: null, push: false };
    const plan = planSettingsStart(server, readBrowserCopy(storage));
    if (plan.document) applySettingsDocument(plan.document);
    return plan;
}

/**
 * Keeps the browser copy and the server in step with the store from now on.
 * Returns the cleanup for an effect.
 */
export function syncSettings(
    server: ServerSettingsSnapshot,
    plan: StartPlan,
    {
        storage = browserLocalStorage(),
        send = putSettings,
        page = typeof window === "undefined" ? null : window,
        delayMs,
    }: {
        storage?: BrowserStorage | null;
        send?: SendSettings;
        page?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
        delayMs?: number;
    } = {},
): () => void {
    const canSave = server.status === "ok";
    const pusher = canSave
        ? createSettingsPusher({ send, delayMs, onSaved: (document) => writeBrowserCopy(storage, document, false) })
        : null;
    activePusher = pusher;

    if (plan.document && canSave) {
        // The copy now matches what the store started with, at the current
        // version; it stays pending until the server saves it.
        writeBrowserCopy(storage, currentSettingsDocument(), plan.push);
    }
    if (plan.push) pusher?.schedule(currentSettingsDocument());

    const unsubscribe = useSettingsStore.subscribe((next, previous) => {
        if (!persistedSlicesChanged(next, previous)) return;
        const document = currentSettingsDocument(next);
        writeBrowserCopy(storage, document, true);
        pusher?.schedule(document);
    });
    const onPageHide = () => pusher?.flushOnExit();
    page?.addEventListener("pagehide", onPageHide);

    return () => {
        unsubscribe();
        page?.removeEventListener("pagehide", onPageHide);
        // Send anything still waiting rather than drop it with the timer.
        void pusher?.flush();
        if (activePusher === pusher) activePusher = null;
    };
}
