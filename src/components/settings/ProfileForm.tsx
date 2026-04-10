"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { profileSchema, type ProfileFormValues } from "@/lib/validators/settings";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function ProfileForm() {
    const profile = useSettingsStore((s) => s.profile);
    const updateProfile = useSettingsStore((s) => s.updateProfile);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: profile,
    });

    // Sync form when store changes externally (e.g., reset settings)
    useEffect(() => {
        reset(profile);
    }, [profile, reset]);

    const onSubmit = (data: ProfileFormValues) => {
        updateProfile(data);
        toast.success("Profile updated successfully");
    };

    return (
        <Card className="border-border shadow-sm">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Profile Information</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="fullName" className="text-base font-normal text-muted-foreground">Full Name</Label>
                        <div className="bg-muted/50 p-1 rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
                            <Input
                                id="fullName"
                                {...register("fullName")}
                                className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                                aria-invalid={!!errors.fullName}
                                aria-describedby={errors.fullName ? "fullName-error" : undefined}
                            />
                        </div>
                        {errors.fullName && (
                            <p id="fullName-error" role="alert" className="text-sm text-destructive">{errors.fullName.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email" className="text-base font-normal text-muted-foreground">Email</Label>
                        <div className="bg-muted/50 p-1 rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
                            <Input
                                id="email"
                                type="email"
                                {...register("email")}
                                className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                                aria-invalid={!!errors.email}
                                aria-describedby={errors.email ? "email-error" : undefined}
                            />
                        </div>
                        {errors.email && (
                            <p id="email-error" role="alert" className="text-sm text-destructive">{errors.email.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="phone" className="text-base font-normal text-muted-foreground">Phone Number</Label>
                        <div className="bg-muted/50 p-1 rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
                            <Input
                                id="phone"
                                {...register("phone")}
                                className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                                aria-invalid={!!errors.phone}
                                aria-describedby={errors.phone ? "phone-error" : undefined}
                            />
                        </div>
                        {errors.phone && (
                            <p id="phone-error" role="alert" className="text-sm text-destructive">{errors.phone.message}</p>
                        )}
                    </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                    <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="font-medium px-6 py-2 h-auto"
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
