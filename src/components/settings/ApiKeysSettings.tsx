"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Trash2, ShieldCheck, AlertCircle } from "lucide-react";
import { useSettingsStore, type ApiKeysSettings as ApiKeysState } from "@/lib/stores/settingsStore";
import { apiKeySchema } from "@/lib/validators/settings";
import { toast } from "sonner";

interface Provider {
    id: keyof ApiKeysState;
    name: string;
    purpose: string;
    docsUrl: string;
    placeholder: string;
}

const providers: Provider[] = [
    {
        id: "polygon",
        name: "Polygon.io",
        purpose: "Primary market data provider (real-time quotes, aggregates, references).",
        docsUrl: "https://polygon.io/dashboard/api-keys",
        placeholder: "pk_xxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    {
        id: "alphaVantage",
        name: "Alpha Vantage",
        purpose: "Fallback provider for quotes when Polygon is unavailable or rate-limited.",
        docsUrl: "https://www.alphavantage.co/support/#api-key",
        placeholder: "XXXXXXXXXXXXXXXX",
    },
    {
        id: "schwab",
        name: "Schwab Developer",
        purpose: "Broker access token for account sync and order routing (stored in memory only).",
        docsUrl: "https://developer.schwab.com/user-guides/api-keys",
        placeholder: "Schwab app secret",
    },
];

function maskKey(key: string): string {
    if (!key) return "";
    if (key.length <= 8) return "•".repeat(key.length);
    return `${key.slice(0, 4)}${"•".repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

export function ApiKeysSettings() {
    const apiKeys = useSettingsStore((s) => s.apiKeys);
    const setProviderKey = useSettingsStore((s) => s.setProviderKey);
    const clearProviderKey = useSettingsStore((s) => s.clearProviderKey);

    // Track which provider's key is currently unmasked (only one at a time)
    const [revealed, setRevealed] = useState<keyof ApiKeysState | null>(null);
    // Local draft state for in-progress edits
    const [drafts, setDrafts] = useState<Partial<Record<keyof ApiKeysState, string>>>({});
    const [errors, setErrors] = useState<Partial<Record<keyof ApiKeysState, string>>>({});

    const toggleReveal = (id: keyof ApiKeysState) => {
        setRevealed((current) => (current === id ? null : id));
    };

    const handleSave = (provider: Provider) => {
        const value = drafts[provider.id] ?? apiKeys[provider.id];
        const parsed = apiKeySchema.safeParse(value);
        if (!parsed.success) {
            setErrors((e) => ({ ...e, [provider.id]: parsed.error.issues[0]?.message ?? "Invalid key" }));
            return;
        }
        setProviderKey(provider.id, parsed.data);
        setErrors((e) => ({ ...e, [provider.id]: undefined }));
        setDrafts((d) => {
            const next = { ...d };
            delete next[provider.id];
            return next;
        });
        toast.success(parsed.data ? `${provider.name} key saved for this session` : `${provider.name} key cleared`);
    };

    const handleClear = (provider: Provider) => {
        clearProviderKey(provider.id);
        setDrafts((d) => {
            const next = { ...d };
            delete next[provider.id];
            return next;
        });
        setErrors((e) => ({ ...e, [provider.id]: undefined }));
        toast.success(`${provider.name} key cleared`);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>API Keys</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="rounded-lg border border-border bg-muted/30 p-4 flex gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="space-y-1 text-sm">
                        <p className="font-medium">Keys stay on this device</p>
                        <p className="text-muted-foreground">
                            API keys are held in memory for the current session only and are never written to
                            localStorage, logged, or sent to third parties other than the provider itself.
                        </p>
                    </div>
                </div>

                {providers.map((provider, idx) => {
                    const stored = apiKeys[provider.id] ?? "";
                    const draft = drafts[provider.id];
                    const isRevealed = revealed === provider.id;
                    const isDirty = draft !== undefined && draft !== stored;
                    const inputValue = isRevealed || isDirty ? (draft ?? stored) : (stored ? maskKey(stored) : "");
                    const errorMessage = errors[provider.id];

                    return (
                        <div key={provider.id}>
                            {idx > 0 && <hr className="border-border mb-6" />}
                            <div className="space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-medium">{provider.name}</h3>
                                            {stored ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="bg-primary/10 text-primary hover:bg-primary/10 gap-1"
                                                >
                                                    <ShieldCheck className="h-3 w-3" />
                                                    Configured
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="gap-1 text-muted-foreground">
                                                    Not set
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-0.5">{provider.purpose}</p>
                                    </div>
                                    <a
                                        href={provider.docsUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="text-sm text-primary hover:underline flex-shrink-0"
                                    >
                                        Get key
                                    </a>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <div className="flex-1">
                                        <Label htmlFor={`key-${provider.id}`} className="sr-only">
                                            {provider.name} API key
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id={`key-${provider.id}`}
                                                type={isRevealed ? "text" : "password"}
                                                placeholder={provider.placeholder}
                                                value={inputValue}
                                                onChange={(e) => {
                                                    setDrafts((d) => ({ ...d, [provider.id]: e.target.value }));
                                                    if (errorMessage) {
                                                        setErrors((err) => ({ ...err, [provider.id]: undefined }));
                                                    }
                                                }}
                                                className="pr-10 font-mono text-sm"
                                                aria-invalid={!!errorMessage}
                                                aria-describedby={errorMessage ? `key-${provider.id}-error` : undefined}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => toggleReveal(provider.id)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                                                aria-label={isRevealed ? "Hide key" : "Show key"}
                                            >
                                                {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                        {errorMessage && (
                                            <p
                                                id={`key-${provider.id}-error`}
                                                role="alert"
                                                className="text-sm text-destructive mt-1 flex items-center gap-1"
                                            >
                                                <AlertCircle className="h-3 w-3" />
                                                {errorMessage}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={() => handleSave(provider)}
                                            disabled={!isDirty}
                                        >
                                            Save
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => handleClear(provider)}
                                            disabled={!stored && !draft}
                                            aria-label={`Clear ${provider.name} key`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
