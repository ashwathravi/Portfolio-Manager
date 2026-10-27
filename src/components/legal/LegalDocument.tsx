import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import { withCallback } from "@/lib/auth/callback-url";
import { resolveViewerIdentity } from "@/lib/auth/viewer";
import { LEGAL_CONTACT_EMAIL, legalBackLink } from "@/lib/legal/links";

export type LegalSearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * A public legal page (Terms of Service, Privacy Policy). Google's consent
 * screen and Plaid link to them, so they're open to signed-out visitors
 * (isPublicRoute in src/proxy.ts) and render without the app chrome
 * (src/components/layout/AppFrame.tsx). A sign-in callback in the URL
 * rides along to the other legal page and back.
 */
export async function LegalDocument({
    title,
    updated,
    intro,
    related,
    searchParams,
    children,
}: {
    title: string;
    updated: string;
    intro: React.ReactNode;
    /** The other legal page, linked at the end. */
    related: { href: string; label: string };
    searchParams: LegalSearchParams;
    children: React.ReactNode;
}) {
    const { callbackUrl: param } = await searchParams;
    const callbackUrl = Array.isArray(param) ? param[0] : param;
    const viewer = await resolveViewerIdentity();
    const back = legalBackLink(callbackUrl, viewer?.mode === "signed-in");

    return (
        <div className="pm-legal-page">
            <article className="pm-legal-doc" aria-labelledby="pm-legal-title">
                <header className="pm-legal-header">
                    <Link href="/" className="pm-login-brand pm-legal-brand">
                        <span className="pm-login-mark" aria-hidden="true">
                            <BrandMark size={20} className="pm-brand-svg" />
                        </span>
                        <span>Atlas Wealth</span>
                    </Link>
                    <h1 id="pm-legal-title">{title}</h1>
                    <p className="pm-legal-updated">Last updated {updated}</p>
                    {intro}
                </header>

                {children}

                <footer className="pm-legal-footer">
                    <Link href={back.href}>{back.label}</Link>
                    <Link href={withCallback(related.href, callbackUrl)}>{related.label}</Link>
                </footer>
            </article>
        </div>
    );
}

export function ContactLink() {
    return <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;
}
