import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/BrandMark";
import { isDatabaseConfigured } from "@/db/connection-options";
import { unsubscribe } from "@/lib/email/preferences";
import { unsubscribeSchema, type EmailList } from "@/lib/validators/email";

export const metadata: Metadata = {
    title: "Unsubscribe | Atlas Wealth",
    description: "Stop an email from Atlas Wealth.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const WHAT: Record<EmailList, string> = {
    alerts: "alert emails",
    weekly_review: "the weekly review email",
};

/**
 * Where the footer of every email links (launch item i58). Opening it
 * changes nothing, since mail scanners open links: the button does. Mail
 * apps unsubscribe in one click through /api/email/unsubscribe instead.
 * Its visitors are mostly signed out, so the link to Settings isn't
 * prefetched: that would only fetch the redirect to sign in.
 */
async function unsubscribeFromLink(formData: FormData) {
    "use server";
    const parsed = unsubscribeSchema.safeParse({ token: formData.get("token"), list: formData.get("list") });
    if (!parsed.success || !isDatabaseConfigured()) redirect("/unsubscribe?invalid=1");
    let found: boolean;
    try {
        found = await unsubscribe(parsed.data.token, parsed.data.list);
    } catch (error) {
        console.error("Unsubscribe failed.", error);
        redirect("/unsubscribe?failed=1");
    }
    redirect(found ? `/unsubscribe?done=${parsed.data.list}` : "/unsubscribe?invalid=1");
}

export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
    const params = await searchParams;
    const done = unsubscribeSchema.shape.list.safeParse(readParam(params.done));
    const link = unsubscribeSchema.safeParse({ token: readParam(params.token), list: readParam(params.list) });

    let title = "Unsubscribe";
    let body: React.ReactNode;
    if (done.success) {
        title = "You’re unsubscribed";
        body = (
            <p role="status" data-testid="unsubscribe-done">
                You won&rsquo;t get {WHAT[done.data]} anymore. You can turn {done.data === "alerts" ? "them" : "it"} back
                on in <Link href="/settings#email" prefetch={false} className="underline underline-offset-2">Settings › Notifications</Link>.
            </p>
        );
    } else if (readParam(params.failed) === "1") {
        body = (
            <p className="pm-login-error" role="alert" data-testid="unsubscribe-failed">
                Something went wrong. Try the link in the email again, or turn emails off in{" "}
                <Link href="/settings#email" prefetch={false} className="underline underline-offset-2">Settings › Notifications</Link>.
            </p>
        );
    } else if (link.success && readParam(params.invalid) !== "1") {
        body = (
            <>
                <p>Stop sending {WHAT[link.data.list]} to you? Nothing else about your account changes.</p>
                <form action={unsubscribeFromLink}>
                    <input type="hidden" name="token" value={link.data.token} />
                    <input type="hidden" name="list" value={link.data.list} />
                    <button type="submit" className="pm-btn pm-btn-primary" data-testid="unsubscribe-confirm">
                        Unsubscribe
                    </button>
                </form>
            </>
        );
    } else {
        body = (
            <p className="pm-login-error" role="alert" data-testid="unsubscribe-invalid">
                This unsubscribe link isn&rsquo;t valid. You can turn emails off in{" "}
                <Link href="/settings#email" prefetch={false} className="underline underline-offset-2">Settings › Notifications</Link>.
            </p>
        );
    }

    return (
        <div className="pm-login-page">
            <section className="pm-login-panel" aria-labelledby="pm-unsubscribe-title">
                <div className="pm-login-brand">
                    <span className="pm-login-mark" aria-hidden="true">
                        <BrandMark size={20} className="pm-brand-svg" />
                    </span>
                    <span>Atlas Wealth</span>
                </div>
                <div className="pm-login-copy">
                    <h1 id="pm-unsubscribe-title">{title}</h1>
                    {body}
                </div>
            </section>
        </div>
    );
}

function readParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
