"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { passwordChangeSchema, type PasswordChangeValues } from "@/lib/validators/settings";
import { toast } from "sonner";

export function SecuritySettings() {
    const twoFactorEnabled = useSettingsStore((s) => s.security.twoFactorEnabled);
    const toggleTwoFactor = useSettingsStore((s) => s.toggleTwoFactor);
    const apiKey = useSettingsStore((s) => s.security.apiKey);
    const setApiKey = useSettingsStore((s) => s.setApiKey);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<PasswordChangeValues>({
        resolver: zodResolver(passwordChangeSchema),
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    const onSubmit = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        reset();
        toast.success("Password updated successfully");
    };

    const handleToggle2FA = () => {
        toggleTwoFactor();
        toast.success(
            twoFactorEnabled
                ? "Two-factor authentication disabled"
                : "Two-factor authentication enabled"
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Change Password */}
                <div>
                    <h3 className="font-medium mb-4">Change Password</h3>
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="current-password">Current password</Label>
                            <Input
                                id="current-password"
                                type="password"
                                placeholder="Current password"
                                {...register("currentPassword")}
                            />
                            {errors.currentPassword && (
                                <p className="text-sm text-destructive">{errors.currentPassword.message}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-password">New password</Label>
                            <Input
                                id="new-password"
                                type="password"
                                placeholder="New password"
                                {...register("newPassword")}
                            />
                            {errors.newPassword && (
                                <p className="text-sm text-destructive">{errors.newPassword.message}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirm-password">Confirm new password</Label>
                            <Input
                                id="confirm-password"
                                type="password"
                                placeholder="Confirm new password"
                                {...register("confirmPassword")}
                            />
                            {errors.confirmPassword && (
                                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                            )}
                        </div>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Updating..." : "Update Password"}
                        </Button>
                    </form>
                </div>

                <hr className="border-border" />

                {/* Two-Factor Authentication */}
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium">Two-Factor Authentication</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Add an extra layer of security to your account
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleToggle2FA}
                    >
                        {twoFactorEnabled ? "Disable 2FA" : "Enable 2FA"}
                    </Button>
                </div>

                <hr className="border-border" />

                {/* API Key for Execution */}
                <div>
                    <h3 className="font-medium mb-2">Internal API Key</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Required for placing orders during this session. This key is not persisted.
                    </p>
                    <div className="flex gap-4">
                        <Input
                            type="password"
                            placeholder="Enter API Key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="max-w-md"
                        />
                        <Button variant="outline" onClick={() => toast.success("API Key updated for this session")}>
                            Update Key
                        </Button>
                    </div>
                </div>

                <hr className="border-border" />

                {/* Active Sessions */}
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium">Active Sessions</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Manage devices where you&apos;re currently logged in
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => toast.info("Session management coming soon")}
                    >
                        View Sessions
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
