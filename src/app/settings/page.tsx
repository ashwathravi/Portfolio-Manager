"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { IntegrationsList } from "@/components/settings/IntegrationsList";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { User, Bell, Shield, Database, Palette, Link as LinkIcon, Tag, Key, Sliders, BellRing } from "lucide-react";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { TagsManager } from "@/components/settings/TagsManager";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";
import { PreferencesSettings } from "@/components/settings/PreferencesSettings";
import { AlertRulesManager } from "@/components/settings/AlertRulesManager";
import { usePageHeader } from "@/components/layout/PageHeaderContext";

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

function SettingsTabs() {
    const searchParams = useSearchParams();
    const requestedTab = searchParams?.get("tab");
    const defaultTab = requestedTab && VALID_TABS.has(requestedTab) ? requestedTab : "profile";

    return (
        <Tabs defaultValue={defaultTab} className="space-y-6">
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
    );
}

export default function SettingsPage() {
    usePageHeader({
        title: 'Settings',
        subtitle: 'Manage account preferences and integrations',
        crumbs: ['System', 'Settings'],
    });

    return (
        <div className="space-y-6 p-10 pb-16 block">
            <div className="space-y-0.5">
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">
                    Manage your account preferences and application settings
                </p>
            </div>

            <Suspense fallback={null}>
                <SettingsTabs />
            </Suspense>
        </div>
    );
}
