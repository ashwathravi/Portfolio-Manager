"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEmailPreferences, useSaveEmailPreferences } from "@/lib/email/queries";

const EMAILS = [
    {
        key: "alerts" as const,
        label: "Alerts",
        description: "Each weekday evening, the alerts your rules raised that you haven’t read in the app.",
    },
    {
        key: "weeklyReview" as const,
        label: "Weekly review",
        description: "Friday evening, the week’s review of the trades you closed. None in a week without closed trades.",
    },
];

/**
 * Which emails the user gets (launch item i58), kept with the account so a
 * one-click unsubscribe sticks. Both are off until turned on.
 */
export function EmailPreferencesCard() {
    const preferences = useEmailPreferences();
    const save = useSaveEmailPreferences();
    const data = preferences.data;
    const stored = data?.stored ?? true;

    const toggle = (key: (typeof EMAILS)[number]["key"], value: boolean) => {
        save.mutate({ [key]: value }, {
            onSuccess: () => toast.success("Email settings updated"),
            onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save your email settings."),
        });
    };

    return (
        <Card id="email" data-testid="email-preferences">
            <CardHeader>
                <CardTitle>Email</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground" data-testid="email-address">
                    {data?.address
                        ? <>Emails go to <strong className="text-foreground">{data.address}</strong>, the address of the Google account you sign in with.</>
                        : "Emails go to the address of the Google account you sign in with."}
                </p>
                {EMAILS.map((email) => (
                    <div key={email.key} className="flex items-center justify-between space-x-2">
                        <Label htmlFor={`email-${email.key}`} className="flex flex-col space-y-1">
                            <span>{email.label}</span>
                            <span className="font-normal text-xs text-muted-foreground">{email.description}</span>
                        </Label>
                        <Switch
                            id={`email-${email.key}`}
                            checked={data?.[email.key] ?? false}
                            disabled={!preferences.isSuccess || !stored}
                            onCheckedChange={(value) => toggle(email.key, value)}
                        />
                    </div>
                ))}
                {preferences.isError ? (
                    <p className="text-xs text-destructive" role="alert" data-testid="email-preferences-error">
                        Your email settings couldn&rsquo;t be loaded. Reload to try again.
                    </p>
                ) : !stored ? (
                    <p className="text-xs text-muted-foreground" data-testid="email-not-stored">
                        Email settings are kept with your account, and this server has no database.
                    </p>
                ) : data && !data.sending ? (
                    <p className="text-xs text-muted-foreground" data-testid="email-not-sending">
                        This server doesn&rsquo;t send email yet. Your choices are saved for when it does.
                    </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                    Every email has a link to unsubscribe from it in one click.
                </p>
            </CardContent>
        </Card>
    );
}
