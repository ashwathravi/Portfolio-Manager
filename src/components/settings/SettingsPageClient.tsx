"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
import { SignInCard } from "./cards/SignInCard";
import { ExampleDataCard } from "./cards/ExampleDataCard";
import { PreferencesSettings } from "./PreferencesSettings";
import { NotificationPreferences } from "./NotificationPreferences";
import { AlertRulesManager } from "./AlertRulesManager";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { DataManagement } from "./DataManagement";
import { TagsManager } from "./TagsManager";
import { SETTINGS_SECTIONS, sectionForTab } from "@/lib/settings/sections";

/**
 * Settings — one column of sections with an anchor rail.
 *
 * Replaces the two-column card masonry plus the separate legacy tabbed
 * layout. Old `?tab=<slug>` links still work: they scroll to the
 * matching section (see lib/settings/sections.ts).
 */

const HEADER = { title: "Settings", subtitle: "Account, data, trading rules, and appearance", crumbs: ["Settings"] };

export function SettingsPageClient() {
    usePageHeader(HEADER);
    const searchParams = useSearchParams();
    const tab = searchParams?.get("tab") ?? null;

    useEffect(() => {
        const id = sectionForTab(tab) ?? (typeof window !== "undefined" ? window.location.hash.slice(1) || null : null);
        if (!id) return;
        const el = document.getElementById(id);
        if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    }, [tab]);

    return (
        <div className="pm-settings-layout">
            <nav className="pm-settings-rail" aria-label="Settings sections">
                {SETTINGS_SECTIONS.map((s) => (
                    <a key={s.id} href={`#${s.id}`} className="pm-settings-rail-link">
                        {s.label}
                    </a>
                ))}
                <Link href="/help" className="pm-settings-rail-link">Help &amp; glossary</Link>
            </nav>

            <div className="pm-settings-sections">
                <Section id="account" title="Account">
                    <ProfileCard />
                    <SignInCard />
                </Section>
                <Section id="accounts" title="Connected accounts">
                    <IntegrationsCard />
                </Section>
                <Section id="data" title="Data">
                    <ExampleDataCard />
                    <DataManagement />
                </Section>
                <Section id="trading" title="Trading rules">
                    <GuardrailsCard />
                    <ExecutionCard />
                </Section>
                <Section id="risk-policy" title="Risk policy">
                    <BucketPolicyCard />
                    <EmployerStockPlanCard />
                    <ChurnPolicyCard />
                    <CashJobsCard />
                    <SellDisciplineCard />
                </Section>
                <Section id="notifications" title="Notifications & alerts">
                    <NotificationPreferences />
                    <AlertRulesManager />
                </Section>
                <Section id="preferences" title="Preferences">
                    <AppearanceCard />
                    <PreferencesSettings />
                    <TagsManager />
                </Section>
                <Section id="api-keys" title="Market data keys">
                    <ApiKeysSettings />
                </Section>
            </div>
        </div>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} className="pm-settings-section" aria-labelledby={`${id}-head`}>
            <h2 id={`${id}-head`} className="pm-settings-section-title">{title}</h2>
            <div className="pm-settings-section-body">{children}</div>
        </section>
    );
}
