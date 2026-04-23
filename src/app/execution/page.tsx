import { ExecutionPageClient } from "@/components/execution/ExecutionPageClient";

/**
 * Phase 7 (AR-83/84/85/86) Execution workspace.
 *
 * Thin server shell. All the page chrome (title, subtitle, crumbs, the
 * Focus/Checkout/Terminal variant switcher that lives in the topbar's
 * actions slot) is owned by `ExecutionPageClient` because the breadcrumb
 * trail updates live with the variant — something a server component
 * can't do without a round-trip.
 *
 * Rendered dynamic so the variant choice (persisted per-user in
 * localStorage) hydrates on every visit without SSR cache surprises.
 */

export const dynamic = "force-dynamic";

export default function ExecutionPage() {
    return <ExecutionPageClient />;
}
