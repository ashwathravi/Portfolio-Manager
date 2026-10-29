import { test } from 'node:test';
import assert from 'node:assert/strict';

// The browser's storage, before the module reads it (no <html>: the anonymous scope).
const kvStore = new Map<string, string>();
Object.assign(globalThis, {
    window: {
        localStorage: {
            getItem: (key: string) => kvStore.get(key) ?? null,
            setItem: (key: string, value: string) => { kvStore.set(key, value); },
            removeItem: (key: string) => { kvStore.delete(key); },
        },
    },
});

test('snoozeId - dismissing an example pattern leaves the same pattern from your trades showing (launch item i51)', async () => {
    const { getSnoozedIds, snoozeId, snoozePattern } = await import('./snooze');
    assert.equal(snoozeId('negative_mood_cost', 'trades'), 'trades:negative_mood_cost');
    // Example patterns keep the key they had before there were real ones.
    assert.equal(snoozeId('negative_mood_cost', 'example'), 'negative_mood_cost');

    snoozePattern(snoozeId('negative_mood_cost', 'example'));
    assert.ok(getSnoozedIds().has(snoozeId('negative_mood_cost', 'example')));
    assert.ok(!getSnoozedIds().has(snoozeId('negative_mood_cost', 'trades')));

    snoozePattern(snoozeId('negative_mood_cost', 'trades'));
    assert.ok(getSnoozedIds().has(snoozeId('negative_mood_cost', 'trades')));
});
