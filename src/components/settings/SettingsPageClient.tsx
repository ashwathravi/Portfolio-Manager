"use client";

import Link from "next/link";
import {
    Bell,
    BellRing,
    Key,
    Database,
    Tag as TagIcon,
    Shield,
    ChevronRight,
} from "lucide-react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { ProfileCard } from "./cards/ProfileCard";
import { IntegrationsCard } from "./cards/IntegrationsCard";
import { AppearanceCard } from "./cards/AppearanceCard";
import { GuardrailsCard } from "./cards/GuardrailsCard";
import { ExecutionCard } from "./cards/ExecutionCard";
import { BucketPolicyCard } from "./cards/BucketPolicyCard";
import { ChurnPolicyCard } from "./cards/ChurnPolicyCard";
import { CashJobsCard } from "./cards/CashJobsCard";
import { SellDisciplineCard } from "./cards/SellDisciplineCard";
import { EmployerStockPlanCard } from "./cards/EmployerStockPlanCard";

interface AdvancedLink {
    slug: string;
    label: string;
    desc: string;
    Icon: typeof Bell;
}

const ADVANCED_LINKS: AdvancedLink[] = [
    {
        slug: "notifications",
        label: "Notifications",
        desc: "Portfolio, price, sync alerts",
        Icon: Bell,
    },
    {
        slug: "alerts",
        label: "Alert rules",
        desc: "Custom price / signal rules",
        Icon: BellRing,
    },
    {
        slug: "api-keys",
        label: "API keys",
        desc: "Polygon, Alpha Vantage, Schwab",
        Icon: Key,
    },
    {
        slug: "security",
        label: "Security",
        desc: "Two-factor, session keys",
        Icon: Shield,
    },
    {
        slug: "data",
        label: "Data & privacy",
        desc: "Export, import, delete",
        Icon: Database,
    },
    {
        slug: "tags",
        label: "Tags",
        desc: "Custom labels across portfolios",
        Icon: TagIcon,
    },
];

/**
 * Phase 8 Settings redesign (AR-87/88/89) + JournalPlus (AR-109).
 *
 * Replaces the old tabbed surface with a card grid. Each card reads
 * and writes directly to the existing `useSettingsStore`, so
 * preferences stay backward-compatible — the server-side shape is
 * unchanged; only the UI is rebuilt.
 *
 *   ┌────────────────── Settings ───────────────────┐
 *   │  [ Profile ]        [ Connected accts ]       │
 *   │  [ Appearance ]     [ Guardrails ]            │
 *   │  [ Execution ]      [ Bucket policy ]         │
 *   │  [ GOOG de-risking ] [ Trading activity ]     │
 *   │  [ Cash jobs ]       [ Sell discipline ]      │
 *   └───────────────────────────────────────────────┘
 *
 * The grid is `auto-fit` + `minmax` so a 5th card (Execution, added in
 * AR-109) flows onto a new row at wide widths and collapses to 1
 * column below ~960px. Each card is self-contained and never needs
 * siblings to render correctly.
 *
 * Deeper tabs (notifications, API keys, data & privacy, tags, alerts)
 * are still reachable via the "Advanced settings" link at the bottom,
 * which falls through to `/settings?tab=…` — same route, the old
 * tabbed layout surfaces when the URL has a tab query string.
 */

export function SettingsPageClient() {
    usePageHeader({
        title: "Settings",
        subtitle: "Profile, integrations, appearance.",
        crumbs: ["System", "Settings"],
    });

    return (
        <div className="pm-settings-v2">
            <div className="pm-settings-grid">
                <ProfileCard />
                <IntegrationsCard />
                <AppearanceCard />
                <GuardrailsCard />
                <ExecutionCard />
                <BucketPolicyCard />
                <EmployerStockPlanCard />
                <ChurnPolicyCard />
                <CashJobsCard />
                <SellDisciplineCard />
            </div>

            <section
                className="pm-settings-advanced"
                aria-labelledby="pm-settings-advanced-head"
            >
                <header className="pm-settings-advanced-head">
                    <h2
                        id="pm-settings-advanced-head"
                        className="pm-settings-advanced-title"
                    >
                        Advanced settings
                    </h2>
                    <p className="pm-settings-advanced-sub">
                        Deeper preference areas still on the legacy tabbed layout.
                    </p>
                </header>
                <div className="pm-settings-advanced-grid">
                    {ADVANCED_LINKS.map((l) => (
                        <Link
                            key={l.slug}
                            href={`/settings?tab=${l.slug}`}
                            className="pm-settings-advanced-link"
                        >
                            <l.Icon
                                className="pm-settings-advanced-icon"
                                aria-hidden="true"
                            />
                            <div className="pm-settings-advanced-text">
                                <span className="pm-settings-advanced-label">
                                    {l.label}
                                </span>
                                <span className="pm-settings-advanced-desc">
                                    {l.desc}
                                </span>
                            </div>
                            <ChevronRight
                                className="pm-settings-advanced-chev"
                                aria-hidden="true"
                            />
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
