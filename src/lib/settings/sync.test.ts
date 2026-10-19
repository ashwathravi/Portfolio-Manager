import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import { userStorageKey } from "@/lib/storage/user-scope";
import { useSettingsStore } from "@/lib/stores/settingsStore";

import { SETTINGS_VERSION, type ServerSettingsSnapshot, type SettingsDocument } from "./document";
import {
    SETTINGS_STORAGE_KEY,
    applySettingsDocument,
    createSettingsPusher,
    currentSettingsDocument,
    persistedSlicesChanged,
    planSettingsStart,
    readBrowserCopy,
    syncSettings,
    writeBrowserCopy,
    type BrowserCopy,
} from "./sync";

// Outside a browser the storage scope is "anonymous".
const KEY = userStorageKey(SETTINGS_STORAGE_KEY, "anonymous");

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

function doc(fullName: string, version = SETTINGS_VERSION): SettingsDocument {
    return { version, settings: { ...currentSettingsDocument().settings, profile: { ...useSettingsStore.getState().profile, fullName } } };
}

const SERVER_NONE: ServerSettingsSnapshot = { status: "ok", document: null };
const UNAVAILABLE: ServerSettingsSnapshot = { status: "unavailable" };

function serverWith(document: SettingsDocument): ServerSettingsSnapshot {
    return { status: "ok", document: { ...document, updatedAt: "2026-10-19T00:00:00.000Z" } };
}

function copy(document: SettingsDocument, flags: Partial<BrowserCopy> = {}): BrowserCopy {
    return { document, pending: false, legacy: false, ...flags };
}

beforeEach(() => useSettingsStore.getState().resetSettings());

describe("readBrowserCopy and writeBrowserCopy", () => {
    test("round-trip a document and whether it is pending", () => {
        const storage = new FakeStorage();
        writeBrowserCopy(storage, doc("Ada"), true);

        const read = readBrowserCopy(storage);
        assert.equal(read?.pending, true);
        assert.equal(read?.legacy, false);
        assert.equal((read?.document.settings.profile as { fullName: string }).fullName, "Ada");
    });

    test("read a copy the persist middleware wrote as legacy", () => {
        const storage = new FakeStorage();
        storage.setItem(KEY, JSON.stringify({ state: { demo: { showSampleData: false } }, version: 14 }));

        assert.deepEqual(readBrowserCopy(storage), {
            document: { version: 14, settings: { demo: { showSampleData: false } } },
            pending: false,
            legacy: true,
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
    const server = doc("From server");
    const browser = doc("From this browser");

    test("the server's copy wins over a synced browser copy", () => {
        const plan = planSettingsStart(serverWith(server), copy(browser));
        assert.equal(plan.push, false);
        assert.equal(plan.document && nameOf(plan.document), "From server");
    });

    test("edits the server never saved win, and are sent", () => {
        const plan = planSettingsStart(serverWith(server), copy(browser, { pending: true }));
        assert.equal(plan.document, browser);
        assert.equal(plan.push, true);
    });

    test("regression: a legacy copy doesn't overwrite settings saved from another device", () => {
        const plan = planSettingsStart(serverWith(server), copy(browser, { legacy: true }));
        assert.equal(plan.push, false);
        assert.equal(plan.document && nameOf(plan.document), "From server");
    });

    test("a browser's settings become the user's when the server has none", () => {
        assert.deepEqual(planSettingsStart(SERVER_NONE, copy(browser, { legacy: true })), { document: browser, push: true });
        assert.deepEqual(planSettingsStart(SERVER_NONE, null), { document: null, push: false });
    });

    test("without the server, the browser copy is all there is", () => {
        assert.deepEqual(planSettingsStart(UNAVAILABLE, copy(browser, { pending: true })), { document: browser, push: false });
        assert.deepEqual(planSettingsStart(UNAVAILABLE, null), { document: null, push: false });
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

    test("sends only the latest document once changes settle", async () => {
        const sent: string[] = [];
        const saved: string[] = [];
        const pusher = createSettingsPusher({
            send: async (document) => { sent.push(nameOf(document)); },
            onSaved: (document) => saved.push(nameOf(document)),
            delayMs: 500,
        });

        pusher.schedule(doc("one"));
        pusher.schedule(doc("two"));
        mock.timers.tick(499);
        assert.deepEqual(sent, []);
        mock.timers.tick(1);
        await pusher.flush();

        assert.deepEqual(sent, ["two"]);
        assert.deepEqual(saved, ["two"]);
    });

    test("keeps a document that failed to save for the next attempt", async () => {
        let fail = true;
        const sent: string[] = [];
        const pusher = createSettingsPusher({
            send: async (document) => {
                sent.push(nameOf(document));
                if (fail) throw new Error("503");
            },
            onSaved: () => {},
        });

        pusher.schedule(doc("one"));
        await pusher.flush();
        fail = false;
        await pusher.flush();

        assert.deepEqual(sent, ["one", "one"]);
    });

    test("doesn't mark a save as the latest when something newer is waiting", async () => {
        const saved: string[] = [];
        let release: () => void = () => {};
        const pusher = createSettingsPusher({
            send: (document) => nameOf(document) === "one" ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve(),
            onSaved: (document) => saved.push(nameOf(document)),
        });

        pusher.schedule(doc("one"));
        const first = pusher.flush();
        pusher.schedule(doc("two"));
        release();
        await first;
        assert.deepEqual(saved, []);

        await pusher.flush();
        assert.deepEqual(saved, ["two"]);
    });

    test("sends what's waiting with keepalive when the page closes", () => {
        const calls: Array<{ name: string; keepalive: boolean }> = [];
        const pusher = createSettingsPusher({
            send: async (document, { keepalive }) => { calls.push({ name: nameOf(document), keepalive }); },
            onSaved: () => {},
        });

        pusher.flushOnExit();
        pusher.schedule(doc("closing"));
        pusher.flushOnExit();

        assert.deepEqual(calls, [{ name: "closing", keepalive: true }]);
    });
});

describe("syncSettings", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("saves each change to the browser copy at once and to the server after", async () => {
        const storage = new FakeStorage();
        const sent: SettingsDocument[] = [];
        const stop = syncSettings(SERVER_NONE, { document: null, push: false }, {
            storage,
            send: async (document) => { sent.push(document); },
            page: null,
            delayMs: 100,
        });

        useSettingsStore.getState().setTheme("dark");
        assert.equal(readBrowserCopy(storage)?.pending, true);
        assert.equal(sent.length, 0);

        mock.timers.tick(100);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(sent.length, 1);
        assert.equal((sent[0].settings.appearance as { theme: string }).theme, "dark");
        assert.equal(readBrowserCopy(storage)?.pending, false);
        stop();
    });

    test("sends a started copy the server lacks, and stops listening when cleaned up", async () => {
        const storage = new FakeStorage();
        const sent: SettingsDocument[] = [];
        applySettingsDocument(doc("Imported"));
        const stop = syncSettings(SERVER_NONE, { document: doc("Imported"), push: true }, {
            storage,
            send: async (document) => { sent.push(document); },
            page: null,
            delayMs: 0,
        });

        mock.timers.tick(0);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(sent.length, 1);
        assert.equal(nameOf(sent[0]), "Imported");

        stop();
        useSettingsStore.getState().setTheme("dark");
        mock.timers.tick(1000);
        assert.equal(sent.length, 1);
    });

    test("sends a change that is still waiting when it stops", async () => {
        const storage = new FakeStorage();
        const sent: SettingsDocument[] = [];
        const stop = syncSettings(SERVER_NONE, { document: null, push: false }, {
            storage,
            send: async (document) => { sent.push(document); },
            page: null,
            delayMs: 10_000,
        });

        useSettingsStore.getState().setTheme("dark");
        stop();
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(sent.length, 1);
    });

    test("without the server, keeps changes in the browser copy only", () => {
        const storage = new FakeStorage();
        let sends = 0;
        const stop = syncSettings(UNAVAILABLE, { document: null, push: false }, {
            storage,
            send: async () => { sends += 1; },
            page: null,
        });

        useSettingsStore.getState().setDensity("compact");
        mock.timers.tick(5000);

        assert.equal(sends, 0);
        assert.equal((readBrowserCopy(storage)?.document.settings.appearance as { density: string }).density, "compact");
        stop();
    });
});

function nameOf(document: SettingsDocument): string {
    return (document.settings.profile as { fullName: string }).fullName;
}
