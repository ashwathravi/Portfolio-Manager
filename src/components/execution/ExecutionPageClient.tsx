"use client";

import { useEffect, useMemo, useState } from "react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import {
    DEFAULT_EXECUTION_VARIANT,
    readExecutionVariant,
    variantCrumb,
    writeExecutionVariant,
    type ExecutionVariant,
} from "@/lib/execution/variant";
import { VariantSwitcher } from "./VariantSwitcher";
import { FocusVariant } from "./FocusVariant";
import { CheckoutVariant } from "./CheckoutVariant";
import { TerminalVariant } from "./TerminalVariant";

/**
 * Phase 7 (AR-83) Execution page client wrapper.
 *
 * Owns the variant state, persists it to localStorage, and drives the
 * topbar breadcrumb + subtitle so the header stays in sync with which
 * layout the user is looking at.
 *
 * SSR note: we always render the default variant on the server, then
 * hydrate to the persisted variant on mount. That's intentional — the
 * alternative (reading localStorage during render) breaks SSR. The first
 * client paint will flicker to the stored variant if it differs, but
 * only once per page load and only when it actually changes.
 *
 * The variant bodies themselves are stubbed here and will be replaced
 * by the real Focus/Checkout/Terminal layouts in AR-84/85/86.
 */

export function ExecutionPageClient() {
    const [variant, setVariant] = useState<ExecutionVariant>(DEFAULT_EXECUTION_VARIANT);
    const [hydrated, setHydrated] = useState(false);

    // On mount, pull the persisted variant. Default stays put if nothing
    // is stored or storage is unavailable.
    useEffect(() => {
        const stored = readExecutionVariant();
        setVariant(stored);
        setHydrated(true);
    }, []);

    const onChange = (next: ExecutionVariant) => {
        setVariant(next);
        writeExecutionVariant(next);
    };

    // Breadcrumb trail updates live with the variant so the topbar always
    // tells the user which surface they're in.
    const crumbs = useMemo(
        () => ["Workspace", "Execution", variantCrumb(variant)],
        [variant],
    );

    // Actions slot hosts the switcher pill group so it sits in the
    // topbar's right-aligned action area — same pattern as Strategies.
    const actions = useMemo(
        () => <VariantSwitcher value={variant} onChange={onChange} />,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [variant],
    );

    usePageHeader({
        title: "Execution",
        subtitle: "Place, manage, and audit your orders.",
        crumbs,
        actions,
    });

    return (
        <div className="pm-exec-page" data-variant={variant} aria-busy={!hydrated}>
            {variant === "focus" && <FocusVariant />}
            {variant === "checkout" && <CheckoutVariant />}
            {variant === "terminal" && <TerminalVariant />}
        </div>
    );
}
