import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import { userStorageKey } from "@/lib/storage/user-scope";
import { useSettingsStore } from "@/lib/stores/settingsStore";

import { SETTINGS_VERSION, type ServerSettingsSnapshot, type SettingsDocument, type StoredSettingsDocument } from "./document";
import {
    SETTINGS_STORAGE_KEY,
    applySettingsDocument,
    createSettingsPusher,
    currentSettingsDocument,
    flushSettings,
    haltSettingsSync,
    persistedSlicesChanged,
    planSettingsStart,
    readBrowserCopy,
    syncSettings,
    writeBrowserCopy,
    type BrowserCopy,
    type SaveResult,
    type SendSettings,
} from "./sync";

// Outside a browser the storage scope is "anonymous".
const KEY = userStorageKey(SETTINGS_STORAGE_KEY, "anonymous");
const T0 = "2026-10-19T08:00:00.000Z";
const T1 = "2026-10-19T09:00:00.000Z";

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

function doc(fullName: string, version = SETTINGS_VERSION): SettingsDocument {
    return { version, settings: { ...currentSettingsDocument().settings, profile: { ...useSettingsStore.getState().profile, fullName } } };
}

function stored(fullName: string, updatedAt: string): StoredSettingsDocument {
    return { ...doc(fullName), updatedAt };
}

function nameOf(document: SettingsDocument): string {
    return (document.settings.profile as { fullName: string }).fullName;
}

const SERVER_NONE: ServerSettingsSnapshot = { status: "ok", document: null };
const UNAVAILABLE: ServerSettingsSnapshot = { status: "unavailable" };
const serverWith = (document: StoredSettingsDocument): ServerSettingsSnapshot => ({ status: "ok", document });
const copy = (document: SettingsDocument, flags: Partial<BrowserCopy> = {}): BrowserCopy =>
    ({ document, pending: false, legacy: false, baseUpdatedAt: null, ...flags });
const saved = (updatedAt = T1): SaveResult => ({ status: "saved", updatedAt });
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => useSettingsStore.getState().resetSettings());

describe("readBrowserCopy and writeBrowserCopy", () => {
    test("round-trip a document, whether it's pending and the version it was made on", () => {
        const storage = new FakeStorage();
        writeBrowserCopy(storage, doc("Ada"), { pending: true, baseUpdatedAt: T0 });

        const read = readBrowserCopy(storage);
        assert.equal(read?.pending, true);
        assert.equal(read?.legacy, false);
        assert.equal(read?.baseUpdatedAt, T0);
        assert.equal(read && nameOf(read.document), "Ada");
    });

    test("read a copy the persist middleware wrote as legacy", () => {
        const storage = new FakeStorage();
        storage.setItem(KEY, JSON.stringify({ state: { demo: { showSampleData: false } }, version: 14 }));

        assert.deepEqual(readBrowserCopy(storage), {
            document: { version: 14, settings: { demo: { showSampleData: false } } },
            pending: false,
            legacy: true,
            baseUpdatedAt: null,
        });
    });

    test("ignore copies that aren't settings", () => {
        const storage = new FakeStorage();
        for (const raw of ["{not json", "null", '{"state":[]}', '{"version":15}']) {
            storage.setItem(KEY, raw);
            assert.equal(readBrowserCopy(storage), null, raw);
        }
    });
});

describe("planSettingsStart", () => {
    test("the server's settings win over a synced copy", () => {
        const plan = planSettingsStart(serverWith(stored("From server", T0)), copy(doc("Here"), { baseUpdatedAt: T0 }));
        assert.equal(plan.document && nameOf(plan.document), "From server");
        assert.equal(plan.push, false);
        assert.equal(plan.baseUpdatedAt, T0);
    });

    test("edits made here on the server's current version win, and are sent", () => {
        const plan = planSettingsStart(serverWith(stored("From server", T0)), copy(doc("Here"), { pending: true, baseUpdatedAt: T0 }));
        assert.equal(plan.document && nameOf(plan.document), "Here");
        assert.equal(plan.push, true);
        assert.equal(plan.baseUpdatedAt, T0);
    });

    test("regression: a pending copy doesn't revert settings saved since it was made", () => {
        // Its save may have gone out with keepalive and landed, or another
        // device saved since; either way the server has the newer settings.
        const plan = planSettingsStart(serverWith(stored("Newer, from another device", T1)), copy(doc("Older here"), { pending: true, baseUpdatedAt: T0 }));
        assert.equal(plan.document && nameOf(plan.document), "Newer, from another device");
        assert.equal(plan.push, false);
        assert.equal(plan.baseUpdatedAt, T1);
    });

    test("a legacy copy doesn't overwrite settings saved from another device", () => {
        const plan = planSettingsStart(serverWith(stored("From server", T0)), copy(doc("Legacy"), { legacy: true }));
        assert.equal(plan.document && nameOf(plan.document), "From server");
        assert.equal(plan.push, false);
    });

    test("a browser's settings become the user's when the server has none", () => {
        const browser = doc("Here");
        assert.deepEqual(planSettingsStart(SERVER_NONE, copy(browser, { legacy: true })), { document: browser, push: true, baseUpdatedAt: null });
        assert.deepEqual(planSettingsStart(SERVER_NONE, null), { document: null, push: false, baseUpdatedAt: null });
    });

    test("without the server, the browser copy is all there is", () => {
        const browser = doc("Here");
        assert.deepEqual(planSettingsStart(UNAVAILABLE, copy(browser, { pending: true, baseUpdatedAt: T0 })), { document: browser, push: false, baseUpdatedAt: T0 });
        assert.deepEqual(planSettingsStart(UNAVAILABLE, null), { document: null, push: false, baseUpdatedAt: null });
    });
});

describe("applySettingsDocument", () => {
    test("loads a document into the store", () => {
        applySettingsDocument(doc("Grace"));
        assert.equal(useSettingsStore.getState().profile.fullName, "Grace");
    });

    test("migrates an older document without changing it", () => {
        const old: SettingsDocument = {
            version: 14,
            settings: { preferences: { ...useSettingsStore.getState().preferences, defaultLandingPage: "/analytics" } },
        };
        applySettingsDocument(old);

        assert.equal(useSettingsStore.getState().preferences.defaultLandingPage, "/performance/behaviour");
        assert.equal(useSettingsStore.getState().demo.showSampleData, true);
        assert.equal((old.settings.preferences as { defaultLandingPage: string }).defaultLandingPage, "/analytics");
    });

    test("regression: a malformed slice falls back to the defaults instead of breaking pages", () => {
        applySettingsDocument({ version: SETTINGS_VERSION, settings: { riskPolicy: {}, guardrails: { approvalThresholdUsd: "lots" } } });

        assert.ok(Array.isArray(useSettingsStore.getState().riskPolicy.bucketPolicies));
        assert.equal(typeof useSettingsStore.getState().guardrails.approvalThresholdUsd, "number");
    });
});

describe("persistedSlicesChanged", () => {
    test("notices persisted slices only", () => {
        const before = useSettingsStore.getState();
        useSettingsStore.getState().setApiKey("sk-session-only");
        assert.equal(persistedSlicesChanged(useSettingsStore.getState(), before), false);

        const beforeTheme = useSettingsStore.getState();
        useSettingsStore.getState().setTheme("dark");
        assert.equal(persistedSlicesChanged(useSettingsStore.getState(), beforeTheme), true);
    });

    test("documents never carry API keys", () => {
        useSettingsStore.getState().setProviderKey("polygon", "pk-secret");
        assert.ok(!JSON.stringify(currentSettingsDocument()).includes("pk-secret"));
    });
});

describe("createSettingsPusher", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("sends only the latest document once changes settle, on the version it knows", async () => {
        const sent: Array<{ name: string; base: string | null; keepalive: boolean }> = [];
        const savedNames: string[] = [];
        const pusher = createSettingsPusher({
            send: async (document, { baseUpdatedAt, keepalive }) => {
                sent.push({ name: nameOf(document), base: baseUpdatedAt, keepalive });
                return saved(T1);
            },
            baseUpdatedAt: T0,
            onSaved: (document) => savedNames.push(nameOf(document)),
            onConflict: () => {},
            delayMs: 500,
        });

        pusher.schedule(doc("one"));
        pusher.schedule(doc("two"));
        mock.timers.tick(499);
        assert.deepEqual(sent, []);
        mock.timers.tick(1);
        await pusher.flush();
        pusher.schedule(doc("three"));
        await pusher.flush();

        assert.deepEqual(sent, [
            { name: "two", base: T0, keepalive: false },
            // The next save is made on the version the last one created.
            { name: "three", base: T1, keepalive: false },
        ]);
        assert.deepEqual(savedNames, ["two", "three"]);
    });

    test("keeps a document that failed to save for the next attempt, and says so", async () => {
        let fail = true;
        const names: string[] = [];
        let failures = 0;
        const pusher = createSettingsPusher({
            send: async (document) => {
                names.push(nameOf(document));
                if (fail) throw new Error("503");
                return saved();
            },
            baseUpdatedAt: null,
            onSaved: () => {},
            onConflict: () => {},
            onFailed: () => { failures += 1; },
        });

        pusher.schedule(doc("one"));
        await pusher.flush();
        fail = false;
        await pusher.flush();

        assert.deepEqual(names, ["one", "one"]);
        assert.equal(failures, 1);
    });

    test("on a conflict, drops what was waiting and hands over the server's settings", async () => {
        const conflicts: Array<StoredSettingsDocument | null> = [];
        const bases: Array<string | null> = [];
        const server = stored("From another device", T1);
        const pusher = createSettingsPusher({
            send: async (_document, { baseUpdatedAt }) => {
                bases.push(baseUpdatedAt);
                return bases.length === 1 ? { status: "conflict", current: server } : saved("2026-10-19T10:00:00.000Z");
            },
            baseUpdatedAt: T0,
            onSaved: () => {},
            onConflict: (current) => conflicts.push(current),
        });

        pusher.schedule(doc("stale"));
        await pusher.flush();
        await pusher.flush();
        pusher.schedule(doc("after"));
        await pusher.flush();

        assert.deepEqual(conflicts, [server]);
        // Nothing was retried, and the next save is made on the server's version.
        assert.deepEqual(bases, [T0, T1]);
    });

    test("says a save isn't the latest when something newer is waiting", async () => {
        const saves: Array<{ name: string; latest: boolean }> = [];
        let release: () => void = () => {};
        const send: SendSettings = (document) => nameOf(document) === "one"
            ? new Promise<SaveResult>((resolve) => { release = () => resolve(saved()); })
            : Promise.resolve(saved("2026-10-19T10:00:00.000Z"));
        const pusher = createSettingsPusher({
            send,
            baseUpdatedAt: null,
            onSaved: (document, _updatedAt, latest) => saves.push({ name: nameOf(document), latest }),
            onConflict: () => {},
        });

        pusher.schedule(doc("one"));
        const first = pusher.flush();
        pusher.schedule(doc("two"));
        release();
        await first;
        assert.deepEqual(saves, [{ name: "one", latest: false }]);

        await pusher.flush();
        assert.deepEqual(saves, [{ name: "one", latest: false }, { name: "two", latest: true }]);
    });

    test("sends what's waiting with keepalive when the page closes, if it fits", () => {
        const calls: Array<{ name: string; keepalive: boolean }> = [];
        const pusher = createSettingsPusher({
            send: async (document, { keepalive }) => {
                calls.push({ name: nameOf(document), keepalive });
                return saved();
            },
            baseUpdatedAt: null,
            onSaved: () => {},
            onConflict: () => {},
        });

        pusher.flushOnExit();
        pusher.schedule(doc("closing"));
        pusher.flushOnExit();
        pusher.schedule(doc("x".repeat(70 * 1024)));
        pusher.flushOnExit();

        // The oversized one waits for the next page load instead.
        assert.deepEqual(calls, [{ name: "closing", keepalive: true }]);
    });
});

describe("createSettingsPusher, as the page closes", () => {
    test("handles the answer to a keepalive save, so the next save is made on its version", async () => {
        const bases: Array<string | null> = [];
        const savedFlags: boolean[] = [];
        const pusher = createSettingsPusher({
            send: async (_document, { baseUpdatedAt }) => {
                bases.push(baseUpdatedAt);
                return saved(bases.length === 1 ? T1 : "2026-10-19T10:00:00.000Z");
            },
            baseUpdatedAt: T0,
            onSaved: (_document, _updatedAt, latest) => savedFlags.push(latest),
            onConflict: () => {},
        });

        pusher.schedule(doc("before leaving"));
        pusher.flushOnExit();
        await settle();
        // Back from the back-forward cache: another edit.
        pusher.schedule(doc("after coming back"));
        await pusher.flush();

        assert.deepEqual(bases, [T0, T1]);
        assert.deepEqual(savedFlags, [true, true]);
    });
});

describe("syncSettings", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("saves each change to the browser copy at once and to the server after", async () => {
        const storage = new FakeStorage();
        const sent: SettingsDocument[] = [];
        const sync = syncSettings(SERVER_NONE, { document: null, push: false, baseUpdatedAt: null }, {
            storage,
            send: async (document) => {
                sent.push(document);
                return saved(T1);
            },
            page: null,
            delayMs: 100,
        });

        useSettingsStore.getState().setTheme("dark");
        assert.equal(readBrowserCopy(storage)?.pending, true);
        assert.equal(sent.length, 0);

        mock.timers.tick(100);
        await settle();
        assert.equal(sent.length, 1);
        assert.equal((sent[0].settings.appearance as { theme: string }).theme, "dark");
        assert.equal(readBrowserCopy(storage)?.pending, false);
        assert.equal(readBrowserCopy(storage)?.baseUpdatedAt, T1);
        sync.stop();
    });

    test("takes the server's settings when another device saved first", async () => {
        const storage = new FakeStorage();
        const replaced: string[] = [];
        let sends = 0;
        const sync = syncSettings(serverWith(stored("Mine", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage,
            send: async () => {
                sends += 1;
                return { status: "conflict", current: stored("From another device", T1) };
            },
            page: null,
            delayMs: 0,
            notices: { onReplaced: () => replaced.push("replaced") },
        });

        useSettingsStore.getState().updateProfile({ fullName: "Stale edit" });
        mock.timers.tick(0);
        await settle();

        assert.equal(useSettingsStore.getState().profile.fullName, "From another device");
        assert.equal(readBrowserCopy(storage)?.pending, false);
        assert.equal(readBrowserCopy(storage)?.baseUpdatedAt, T1);
        assert.deepEqual(replaced, ["replaced"]);
        // Taking the server's settings isn't itself sent back.
        mock.timers.tick(1000);
        await settle();
        assert.equal(sends, 1);
        sync.stop();
    });

    test("sends a started copy the server lacks, and stops listening when cleaned up", async () => {
        const storage = new FakeStorage();
        const sent: SettingsDocument[] = [];
        applySettingsDocument(doc("Imported"));
        const sync = syncSettings(SERVER_NONE, { document: doc("Imported"), push: true, baseUpdatedAt: null }, {
            storage,
            send: async (document) => {
                sent.push(document);
                return saved();
            },
            page: null,
            delayMs: 0,
        });

        mock.timers.tick(0);
        await settle();
        assert.equal(sent.length, 1);
        assert.equal(nameOf(sent[0]), "Imported");

        sync.stop();
        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(1000);
        assert.equal(sent.length, 1);
    });

    test("sends a change that is still waiting when it stops", async () => {
        const sent: SettingsDocument[] = [];
        const sync = syncSettings(SERVER_NONE, { document: null, push: false, baseUpdatedAt: null }, {
            storage: new FakeStorage(),
            send: async (document) => {
                sent.push(document);
                return saved();
            },
            page: null,
            delayMs: 10_000,
        });

        useSettingsStore.getState().setTheme("dark");
        sync.stop();
        await settle();

        assert.equal(sent.length, 1);
    });

    test("without the server, keeps changes in the browser copy only", () => {
        const storage = new FakeStorage();
        let sends = 0;
        const sync = syncSettings(UNAVAILABLE, { document: null, push: false, baseUpdatedAt: null }, {
            storage,
            send: async () => {
                sends += 1;
                return saved();
            },
            page: null,
        });

        useSettingsStore.getState().setDensity("compact");
        mock.timers.tick(5000);

        assert.equal(sends, 0);
        assert.equal((readBrowserCopy(storage)?.document.settings.appearance as { density: string }).density, "compact");
        sync.stop();
    });

    test("regression: a save that lands while a newer edit waits moves that edit onto the new version", async () => {
        const storage = new FakeStorage();
        let release: () => void = () => {};
        let calls = 0;
        const sync = syncSettings(serverWith(stored("Start", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage,
            send: () => {
                calls += 1;
                return calls === 1
                    ? new Promise<SaveResult>((resolve) => { release = () => resolve(saved(T1)); })
                    : new Promise<SaveResult>(() => {});
            },
            page: null,
            delayMs: 0,
        });

        useSettingsStore.getState().updateProfile({ fullName: "A" });
        mock.timers.tick(0);
        await settle();
        useSettingsStore.getState().updateProfile({ fullName: "B" });
        release();
        await settle();

        const copy = readBrowserCopy(storage);
        assert.equal(copy && nameOf(copy.document), "B");
        assert.equal(copy?.pending, true);
        // B was made on A's version, so a reload sends B instead of dropping it.
        assert.equal(copy?.baseUpdatedAt, T1);
        sync.stop();
    });

    test("regression: a refreshed layout after its own save doesn't make the next edit conflict", async () => {
        const storage = new FakeStorage();
        const bases: Array<string | null> = [];
        const sync = syncSettings(serverWith(stored("Start", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage,
            send: async (_document, { baseUpdatedAt }) => {
                bases.push(baseUpdatedAt);
                return saved(bases.length === 1 ? T1 : "2026-10-19T10:00:00.000Z");
            },
            page: null,
            delayMs: 0,
        });

        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(0);
        await settle();
        // router.refresh(): the layout hands over the snapshot of that save.
        sync.rebase(serverWith({ ...currentSettingsDocument(), updatedAt: T1 }));
        useSettingsStore.getState().setDensity("compact");
        mock.timers.tick(0);
        await settle();

        assert.deepEqual(bases, [T0, T1]);
        assert.equal(useSettingsStore.getState().appearance.density, "compact");
        sync.stop();
    });

    test("a refreshed layout with newer settings from elsewhere replaces these when nothing is waiting", () => {
        const sync = syncSettings(serverWith(stored("Start", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage: new FakeStorage(),
            send: async () => saved(),
            page: null,
        });

        sync.rebase(serverWith(stored("From another device", T1)));

        assert.equal(useSettingsStore.getState().profile.fullName, "From another device");
        sync.stop();
    });

    test("regression: never saves over settings from a newer version of the app", () => {
        const storage = new FakeStorage();
        let sends = 0;
        const readOnlyNotices: string[] = [];
        const future: StoredSettingsDocument = { ...stored("From a newer app", T0), version: SETTINGS_VERSION + 1 };
        const sync = syncSettings(serverWith(future), { document: future, push: false, baseUpdatedAt: T0 }, {
            storage,
            send: async () => {
                sends += 1;
                return saved();
            },
            page: null,
            delayMs: 0,
            notices: { onReadOnly: () => readOnlyNotices.push("read-only") },
        });

        useSettingsStore.getState().setTheme("dark");
        useSettingsStore.getState().setDensity("compact");
        mock.timers.tick(1000);

        assert.equal(sends, 0);
        // Nor is a copy in this version's shape left pending for a newer app to save.
        assert.equal(readBrowserCopy(storage)?.pending ?? false, false);
        assert.deepEqual(readOnlyNotices, ["read-only"]);
        sync.stop();
    });

    test("regression: starts saving when a refreshed layout says the database is back", async () => {
        const storage = new FakeStorage();
        const sent: Array<{ name: string; base: string | null }> = [];
        const sync = syncSettings(UNAVAILABLE, { document: null, push: false, baseUpdatedAt: null }, {
            storage,
            send: async (document, { baseUpdatedAt }) => {
                sent.push({ name: nameOf(document), base: baseUpdatedAt });
                return saved(T1);
            },
            page: null,
            delayMs: 0,
        });

        useSettingsStore.getState().updateProfile({ fullName: "Edited during the outage" });
        mock.timers.tick(0);
        await settle();
        assert.deepEqual(sent, []);

        sync.rebase(SERVER_NONE);
        mock.timers.tick(0);
        await settle();
        assert.deepEqual(sent, [{ name: "Edited during the outage", base: null }]);

        useSettingsStore.getState().updateProfile({ fullName: "And after" });
        mock.timers.tick(0);
        await settle();
        assert.deepEqual(sent[1], { name: "And after", base: T1 });
        sync.stop();
    });

    test("when the database is back with newer settings and nothing here is unsaved, takes them", () => {
        const storage = new FakeStorage();
        writeBrowserCopy(storage, doc("Old copy"), { pending: false, baseUpdatedAt: T0 });
        const sync = syncSettings(UNAVAILABLE, { document: doc("Old copy"), push: false, baseUpdatedAt: T0 }, {
            storage,
            send: async () => saved(),
            page: null,
        });

        sync.rebase(serverWith(stored("Newer on the server", T1)));

        assert.equal(useSettingsStore.getState().profile.fullName, "Newer on the server");
        assert.equal(readBrowserCopy(storage)?.baseUpdatedAt, T1);
        sync.stop();
    });

    test("regression: ignores a refreshed snapshot older than this page's latest save", async () => {
        const sync = syncSettings(serverWith(stored("Start", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage: new FakeStorage(),
            send: async () => saved(T1),
            page: null,
            delayMs: 0,
        });

        useSettingsStore.getState().updateProfile({ fullName: "Saved just now" });
        mock.timers.tick(0);
        await settle();
        // A refresh that read the settings before that save landed.
        sync.rebase(serverWith(stored("Start", T0)));

        assert.equal(useSettingsStore.getState().profile.fullName, "Saved just now");
        sync.stop();
    });

    test("regression: sign-out's flush gives up on a stalled save", async () => {
        const sync = syncSettings(SERVER_NONE, { document: null, push: false, baseUpdatedAt: null }, {
            storage: new FakeStorage(),
            send: () => new Promise<SaveResult>(() => {}),
            page: null,
            delayMs: 0,
        });
        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(0);

        let flushed = false;
        const flushing = flushSettings(3000).then(() => { flushed = true; });
        await settle();
        assert.equal(flushed, false);
        mock.timers.tick(3000);
        await flushing;

        assert.equal(flushed, true);
        sync.stop();
    });

    test("regression: after sign-out halts sync, a late answer doesn't write the copy back", async () => {
        const storage = new FakeStorage();
        let answer: () => void = () => {};
        const sync = syncSettings(SERVER_NONE, { document: null, push: false, baseUpdatedAt: null }, {
            storage,
            send: () => new Promise<SaveResult>((resolve) => { answer = () => resolve(saved(T1)); }),
            page: null,
            delayMs: 0,
        });
        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(0);
        await settle();

        haltSettingsSync();
        storage.store.clear();
        answer();
        await settle();
        useSettingsStore.getState().setDensity("compact");

        assert.equal(storage.store.size, 0);
        sync.stop();
    });
});

describe("createSettingsPusher, with a save on its way as the page closes", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("regression: sends the edit that was waiting once the earlier save settles", async () => {
        const sent: string[] = [];
        let answerFirst: () => void = () => {};
        const pusher = createSettingsPusher({
            send: (document) => {
                sent.push(nameOf(document));
                return sent.length === 1
                    ? new Promise<SaveResult>((resolve) => { answerFirst = () => resolve(saved(T1)); })
                    : Promise.resolve(saved("2026-10-19T10:00:00.000Z"));
            },
            baseUpdatedAt: T0,
            onSaved: () => {},
            onConflict: () => {},
            delayMs: 100,
        });

        pusher.schedule(doc("A"));
        mock.timers.tick(100);
        pusher.schedule(doc("B"));
        // The page goes into the back-forward cache, and comes back.
        pusher.flushOnExit();
        answerFirst();
        await settle();
        mock.timers.tick(100);
        await settle();

        assert.deepEqual(sent, ["A", "B"]);
    });

    test("regression: a failed save waits for the next change instead of retrying on its own", async () => {
        let sends = 0;
        const pusher = createSettingsPusher({
            send: async () => {
                sends += 1;
                throw new Error("503");
            },
            baseUpdatedAt: T0,
            onSaved: () => {},
            onConflict: () => {},
            delayMs: 100,
        });

        pusher.schedule(doc("A"));
        mock.timers.tick(100);
        await settle();
        mock.timers.tick(60_000);
        await settle();

        assert.equal(sends, 1);
        pusher.schedule(doc("B"));
        mock.timers.tick(100);
        await settle();
        assert.equal(sends, 2);
    });
});

describe("syncSettings, with settings from a newer version of the app", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("regression: keeps the newer document as it is in the browser copy, and stays read-only on it", async () => {
        const storage = new FakeStorage();
        const future: StoredSettingsDocument = { ...stored("From a newer app", T1), version: SETTINGS_VERSION + 1 };
        const sync = syncSettings(serverWith(stored("Start", T0)), { document: null, push: false, baseUpdatedAt: T0 }, {
            storage,
            send: async () => ({ status: "conflict", current: future }),
            page: null,
            delayMs: 0,
        });

        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(0);
        await settle();
        sync.stop();

        const copy = readBrowserCopy(storage);
        assert.equal(copy?.document.version, SETTINGS_VERSION + 1);
        assert.equal(copy?.pending, false);

        // A reload during an outage starts from that copy: still read-only.
        let sends = 0;
        const plan = planSettingsStart(UNAVAILABLE, copy);
        const reloaded = syncSettings(UNAVAILABLE, plan, {
            storage,
            send: async () => {
                sends += 1;
                return saved();
            },
            page: null,
        });
        useSettingsStore.getState().setDensity("compact");
        reloaded.rebase(serverWith(future));
        useSettingsStore.getState().setDensity("comfortable");
        mock.timers.tick(5000);
        await settle();

        assert.equal(sends, 0);
        assert.equal(readBrowserCopy(storage)?.document.version, SETTINGS_VERSION + 1);
        assert.equal(readBrowserCopy(storage)?.pending, false);
        reloaded.stop();
    });
});
