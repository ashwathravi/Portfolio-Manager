"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { preferencesSchema, type PreferencesFormValues } from "@/lib/validators/settings";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const currencyOptions: { value: PreferencesFormValues["baseCurrency"]; label: string }[] = [
    { value: "USD", label: "USD — US Dollar" },
    { value: "EUR", label: "EUR — Euro" },
    { value: "GBP", label: "GBP — British Pound" },
    { value: "CAD", label: "CAD — Canadian Dollar" },
    { value: "AUD", label: "AUD — Australian Dollar" },
    { value: "JPY", label: "JPY — Japanese Yen" },
    { value: "CHF", label: "CHF — Swiss Franc" },
    { value: "INR", label: "INR — Indian Rupee" },
];

const dateFormatOptions: { value: PreferencesFormValues["dateFormat"]; label: string; example: string }[] = [
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY", example: "04/19/2026" },
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY", example: "19/04/2026" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)", example: "2026-04-19" },
];

const numberFormatOptions: { value: PreferencesFormValues["numberFormat"]; label: string; example: string }[] = [
    { value: "en-US", label: "US (1,234.56)", example: "1,234.56" },
    { value: "en-GB", label: "UK (1,234.56)", example: "1,234.56" },
    { value: "de-DE", label: "German (1.234,56)", example: "1.234,56" },
    { value: "fr-FR", label: "French (1 234,56)", example: "1 234,56" },
];

const landingPageOptions: { value: PreferencesFormValues["defaultLandingPage"]; label: string }[] = [
    { value: "/", label: "Dashboard" },
    { value: "/performance", label: "Performance" },
    { value: "/analytics", label: "Trade Analytics" },
    { value: "/portfolios", label: "Portfolio" },
    { value: "/research", label: "Research" },
    { value: "/strategies", label: "Strategies" },
];

export function PreferencesSettings() {
    const preferences = useSettingsStore((s) => s.preferences);
    const updatePreferences = useSettingsStore((s) => s.updatePreferences);

    const {
        register,
        handleSubmit,
        reset,
        control,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<PreferencesFormValues>({
        resolver: zodResolver(preferencesSchema),
        defaultValues: preferences,
    });

    useEffect(() => {
        reset(preferences);
    }, [preferences, reset]);

    const onSubmit = (data: PreferencesFormValues) => {
        updatePreferences(data);
        toast.success("Preferences saved");
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Preferences</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Base Currency */}
                        <div className="space-y-2">
                            <Label htmlFor="baseCurrency">Base currency</Label>
                            <p className="text-xs text-muted-foreground">Used for portfolio totals and reporting</p>
                            <Controller
                                name="baseCurrency"
                                control={control}
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <SelectTrigger id="baseCurrency">
                                            <SelectValue placeholder="Select currency" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {currencyOptions.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>

                        {/* Default Landing Page */}
                        <div className="space-y-2">
                            <Label htmlFor="defaultLandingPage">Default landing page</Label>
                            <p className="text-xs text-muted-foreground">Where to go after signing in</p>
                            <Controller
                                name="defaultLandingPage"
                                control={control}
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <SelectTrigger id="defaultLandingPage">
                                            <SelectValue placeholder="Select page" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {landingPageOptions.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>

                        {/* Date Format */}
                        <div className="space-y-2">
                            <Label htmlFor="dateFormat">Date format</Label>
                            <p className="text-xs text-muted-foreground">How dates appear across the app</p>
                            <Controller
                                name="dateFormat"
                                control={control}
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <SelectTrigger id="dateFormat">
                                            <SelectValue placeholder="Select date format" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {dateFormatOptions.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    <span className="font-mono">{opt.label}</span>
                                                    <span className="text-muted-foreground ml-2">e.g. {opt.example}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>

                        {/* Number Format */}
                        <div className="space-y-2">
                            <Label htmlFor="numberFormat">Number format</Label>
                            <p className="text-xs text-muted-foreground">Thousands and decimal separators</p>
                            <Controller
                                name="numberFormat"
                                control={control}
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <SelectTrigger id="numberFormat">
                                            <SelectValue placeholder="Select number format" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {numberFormatOptions.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </div>
                    </div>

                    <hr className="border-border" />

                    {/* Market Data Refresh */}
                    <div className="space-y-2 max-w-sm">
                        <Label htmlFor="marketDataRefreshSeconds">Market data refresh (seconds)</Label>
                        <p className="text-xs text-muted-foreground">
                            How often to refetch live quotes. Lower values hit provider rate limits faster.
                        </p>
                        <Input
                            id="marketDataRefreshSeconds"
                            type="number"
                            min={15}
                            max={3600}
                            step={5}
                            {...register("marketDataRefreshSeconds", { valueAsNumber: true })}
                            aria-invalid={!!errors.marketDataRefreshSeconds}
                            aria-describedby={errors.marketDataRefreshSeconds ? "refresh-error" : undefined}
                        />
                        {errors.marketDataRefreshSeconds && (
                            <p id="refresh-error" role="alert" className="text-sm text-destructive">
                                {errors.marketDataRefreshSeconds.message}
                            </p>
                        )}
                    </div>
                </CardContent>
                <CardFooter>
                    <Button type="submit" disabled={isSubmitting || !isDirty}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSubmitting ? "Saving..." : "Save Preferences"}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
