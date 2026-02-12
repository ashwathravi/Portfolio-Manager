"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { IntegrationsList } from "@/components/settings/IntegrationsList";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { DataManagement } from "@/components/settings/DataManagement";

export default function SettingsPage() {
    return (
        <div className="space-y-6 p-10 pb-16 block">
            <div className="space-y-0.5">
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">
                    Manage your account settings and set e-mail preferences.
                </p>
            </div>
            <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
                <aside className="-mx-4 lg:w-1/5">
                    {/* Sidebar navigation could go here, but using Tabs for now */}
                </aside>
                <div className="flex-1 lg:max-w-4xl">
                    <Tabs defaultValue="profile" className="space-y-6">
                        <TabsList className="grid w-full grid-cols-5 h-auto">
                            <TabsTrigger value="profile">Profile</TabsTrigger>
                            <TabsTrigger value="integrations">Integrations</TabsTrigger>
                            <TabsTrigger value="notifications">Notifications</TabsTrigger>
                            <TabsTrigger value="security">Security</TabsTrigger>
                            <TabsTrigger value="data">Data</TabsTrigger>
                        </TabsList>

                        <TabsContent value="profile" className="space-y-6">
                            <ProfileForm />
                        </TabsContent>

                        <TabsContent value="integrations" className="space-y-6">
                            <IntegrationsList />
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
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
