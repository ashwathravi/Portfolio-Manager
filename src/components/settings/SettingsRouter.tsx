"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { ProfileForm } from "./ProfileForm";
import { IntegrationsList } from "./IntegrationsList";
import { NotificationPreferences } from "./NotificationPreferences";
import { SecuritySettings } from "./SecuritySettings";
import { DataManagement } from "./DataManagement";
import { AppearanceSettings } from "./AppearanceSettings";
import { TagsManager } from "./TagsManager";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { PreferencesSettings } from "./PreferencesSettings";
import { AlertRulesManager } from "./AlertRulesManager";
import { SettingsPageClient } from "./SettingsPageClient";
import {
    User,
    Bell,
    Shield,
    Database,
    Palette,
    Link as LinkIcon,
    Tag,
    Key,
    Sliders,
    BellRing,
    ArrowLeft,
} from "lucide-react";

/**
 * AR-87 — Settings router.
 *
 * Branches between:
 *   - the new 4-card grid (no `?tab=` query), owned by AR-87/88/89
 *   - the legacy tabbed surface (when `?tab=<slug>` is in the URL),
 *     kept so the deeper preference areas (notifications, API keys,
 *     etc.) are still reachable until they get their own redesign.
 *
 * The router is a client component because:
 *   1. `useSearchParams` has to run on the client.
 *   2. Both branches call `usePageHeader`, which is a client-only hook.
 */

const VALID_TABS = new Set([
    "profile",
    "preferences",
    "notifications",
    "alerts",
    "security",
    "api-keys",
    "data",
    "appearance",
    "accounts",
    "tags",
]);

export function SettingsRouter() {
    const searchParams = useSearchParams();
    const requestedTab = searchParams?.get("tab");
    const isTabMode = !!requestedTab && VALID_TABS.has(requestedTab);

    if (isTabMode) {
        return <LegacyTabbedSettings initialTab={requestedTab!} />;
    }

    return <SettingsPageClient />;
}

// --------------------------------------------------------------------- //
// Legacy tabbed settings (still used by ?tab=… deep links)
// --------------------------------------------------------------------- //

function LegacyTabbedSettings({ initialTab }: { initialTab: string }) {
    usePageHeader({
        title: "Settings",
        subtitle: "Advanced preferences",
        crumbs: ["System", "Settings", "Advanced"],
    });

    return (
        <div className="space-y-6 p-10 pb-16 block">
            <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                    <h2 className="text-2xl font-bold tracking-tight">Advanced settings</h2>
                    <p className="text-muted-foreground">
                        Deeper preferences not yet rebuilt in the new layout.
                    </p>
                </div>
                <Link
                    href="/settings"
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Settings
                </Link>
            </div>

            <Tabs defaultValue={initialTab} className="space-y-6">
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
                    <TabsTrigger
                        value="profile"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <User className="h-4 w-4" />
                        Profile
                    </TabsTrigger>
                    <TabsTrigger
                        value="preferences"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Sliders className="h-4 w-4" />
                        Preferences
                    </TabsTrigger>
                    <TabsTrigger
                        value="notifications"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Bell className="h-4 w-4" />
                        Notifications
                    </TabsTrigger>
                    <TabsTrigger
                        value="alerts"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <BellRing className="h-4 w-4" />
                        Alerts
                    </TabsTrigger>
                    <TabsTrigger
                        value="security"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Shield className="h-4 w-4" />
                        Security
                    </TabsTrigger>
                    <TabsTrigger
                        value="api-keys"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Key className="h-4 w-4" />
                        API Keys
                    </TabsTrigger>
                    <TabsTrigger
                        value="data"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Database className="h-4 w-4" />
                        Data & Privacy
                    </TabsTrigger>
                    <TabsTrigger
                        value="appearance"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Palette className="h-4 w-4" />
                        Appearance
                    </TabsTrigger>
                    <TabsTrigger
                        value="accounts"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <LinkIcon className="h-4 w-4" />
                        Accounts
                    </TabsTrigger>
                    <TabsTrigger
                        value="tags"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Tag className="h-4 w-4" />
                        Tags
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-6">
                    <ProfileForm />
                </TabsContent>
                <TabsContent value="preferences" className="space-y-6">
                    <PreferencesSettings />
                </TabsContent>
                <TabsContent value="notifications" className="space-y-6">
                    <NotificationPreferences />
                </TabsContent>
                <TabsContent value="alerts" className="space-y-6">
                    <AlertRulesManager />
                </TabsContent>
                <TabsContent value="security" className="space-y-6">
                    <SecuritySettings />
                </TabsContent>
                <TabsContent value="api-keys" className="space-y-6">
                    <ApiKeysSettings />
                </TabsContent>
                <TabsContent value="data" className="space-y-6">
                    <DataManagement />
                </TabsContent>
                <TabsContent value="appearance" className="space-y-6">
                    <AppearanceSettings />
                </TabsContent>
                <TabsContent value="accounts" className="space-y-6">
                    <IntegrationsList />
                </TabsContent>
                <TabsContent value="tags" className="space-y-6">
                    <TagsManager />
                </TabsContent>
            </Tabs>
        </div>
    );
}
