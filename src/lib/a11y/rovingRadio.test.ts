import { describe, test, beforeEach } from "node:test";
import assert from "node:assert";
import type { KeyboardEvent } from "react";

import { handleRovingRadioKey } from "./rovingRadio";

/**
 * Unit tests for the ARIA 1.2 roving-radiogroup keyboard handler used by
 * AR-64 density seg, AR-65 accent picker, and the AR-68 Tweaks panel.
 *
 * The function reads `e.currentTarget.parentElement` to move DOM focus
 * after selection — we stub a minimal DOM-like shape rather than pulling
 * in jsdom, because the only child API the function touches is
 * `.children[i].focus()`.
 */

type MockButton = {
    focus: () => void;
    focused: boolean;
};

/**
 * Build a stubbed KeyboardEvent-like object with a `currentTarget` whose
 * `parentElement` exposes a `.children` array of objects with `.focus()`.
 * This matches the subset of the DOM that `handleRovingRadioKey` reads.
 */
function makeEvent(
    key: string,
    siblings: MockButton[],
    currentIdx: number,
): {
    key: string;
    preventCalled: boolean;
    defaultPrevented: boolean;
    preventDefault: () => void;
    currentTarget: {
        parentElement: {
            children: MockButton[];
        };
    };
} {
    const evt = {
        key,
        defaultPrevented: false,
        preventCalled: false,
        preventDefault() {
            evt.preventCalled = true;
            evt.defaultPrevented = true;
        },
        currentTarget: {
            parentElement: {
                children: siblings,
            },
        },
    };
    // currentIdx is here for doc only — the handler reads from `order` + the
    // `current` param, not from the DOM. We keep `siblings[currentIdx]` only
    // so focus assertions are easy to verify.
    void currentIdx;
    return evt;
}

function makeButtons(n: number): MockButton[] {
    return Array.from({ length: n }, () => {
        const btn: MockButton = {
            focused: false,
            focus() {
                btn.focused = true;
            },
        };
        return btn;
    });
}

const ORDER = ["a", "b", "c", "d"] as const;

// `handleRovingRadioKey` schedules focus via requestAnimationFrame. In
// node:test there is no real rAF, so we stub it to fire synchronously.
// This keeps the tests deterministic and avoids flakiness.
const originalRaf = globalThis.requestAnimationFrame;
function installSyncRaf() {
    const rafHost = globalThis as typeof globalThis & { requestAnimationFrame: typeof requestAnimationFrame };
    rafHost.requestAnimationFrame = (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
    };
}
function restoreRaf() {
    const rafHost = globalThis as typeof globalThis & { requestAnimationFrame: typeof requestAnimationFrame };
    rafHost.requestAnimationFrame = originalRaf;
}

function asKeyboardEvent(evt: ReturnType<typeof makeEvent>): KeyboardEvent<HTMLElement> {
    return evt as unknown as KeyboardEvent<HTMLElement>;
}

describe("handleRovingRadioKey", () => {
    beforeEach(() => {
        installSyncRaf();
    });

    test("ArrowRight moves selection forward", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowRight", siblings, 0);
        let selected: string = "a";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "a", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "b");
        assert.strictEqual(siblings[1].focused, true);
        assert.strictEqual(evt.defaultPrevented, true);
        restoreRaf();
    });

    test("ArrowDown moves selection forward (same as ArrowRight)", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowDown", siblings, 1);
        let selected: string = "b";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "b", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "c");
        assert.strictEqual(siblings[2].focused, true);
        restoreRaf();
    });

    test("ArrowLeft moves selection backward", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowLeft", siblings, 2);
        let selected: string = "c";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "c", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "b");
        assert.strictEqual(siblings[1].focused, true);
        restoreRaf();
    });

    test("ArrowUp wraps from first to last", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowUp", siblings, 0);
        let selected: string = "a";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "a", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "d");
        assert.strictEqual(siblings[3].focused, true);
        restoreRaf();
    });

    test("ArrowRight wraps from last to first", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowRight", siblings, 3);
        let selected: string = "d";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "d", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "a");
        assert.strictEqual(siblings[0].focused, true);
        restoreRaf();
    });

    test("Home selects first", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("Home", siblings, 2);
        let selected: string = "c";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "c", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "a");
        assert.strictEqual(siblings[0].focused, true);
        restoreRaf();
    });

    test("End selects last", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("End", siblings, 0);
        let selected: string = "a";
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "a", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "d");
        assert.strictEqual(siblings[3].focused, true);
        restoreRaf();
    });

    test("non-navigation key is a no-op (no selection change, no preventDefault)", () => {
        const siblings = makeButtons(4);
        const evt = makeEvent("Enter", siblings, 0);
        let callbackFired = false;
        handleRovingRadioKey(asKeyboardEvent(evt), ORDER, "a", () => {
            callbackFired = true;
        });
        assert.strictEqual(callbackFired, false);
        assert.strictEqual(evt.defaultPrevented, false);
        assert.strictEqual(
            siblings.every((s) => !s.focused),
            true,
            "no sibling should have received focus",
        );
        restoreRaf();
    });

    test("current index not found in order — starts from index 0", () => {
        // If the caller hands us a `current` that isn't in `order` (which
        // shouldn't happen in practice but defensively: e.g. stale state),
        // we should fall back to index 0 so ArrowRight lands on index 1.
        const siblings = makeButtons(4);
        const evt = makeEvent("ArrowRight", siblings, 0);
        let selected: string = "x";
        handleRovingRadioKey<string>(asKeyboardEvent(evt), ORDER, "z", (next) => {
            selected = next;
        });
        assert.strictEqual(selected, "b");
        restoreRaf();
    });
});
