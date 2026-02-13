"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { IntegrationsList } from "@/components/settings/IntegrationsList";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { User, Bell, Shield, Database, Palette, Link as LinkIcon, Tag } from "lucide-react";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { TagsManager } from "@/components/settings/TagsManager";

export default function SettingsPage() {
    return (
        <div className="space-y-6 p-10 pb-16 block">
            <div className="space-y-0.5">
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">
                    Manage your account preferences and application settings
                </p>
            </div>

            <Tabs defaultValue="profile" className="space-y-6">
                <TabsList className="flex h-auto w-full justify-start gap-2 bg-transparent p-0">
                    <TabsTrigger
                        value="profile"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <User className="h-4 w-4" />
                        Profile
                    </TabsTrigger>
                    <TabsTrigger
                        value="notifications"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Bell className="h-4 w-4" />
                        Notifications
                    </TabsTrigger>
                    <TabsTrigger
                        value="security"
                        className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-full px-4 py-2 gap-2"
                    >
                        <Shield className="h-4 w-4" />
                        Security
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

                <TabsContent value="notifications" className="space-y-6">
                    <NotificationPreferences />
                </TabsContent>

                <TabsContent value="security" className="space-y-6">
                    <SecuritySettings />
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
