import { safeCallbackPath, withCallback } from "@/lib/auth/callback-url";

/** Where questions about the terms and the privacy policy go. */
export const LEGAL_CONTACT_EMAIL = "ashwath.ravi@gmail.com";

export interface LegalBackLink {
    href: string;
    label: string;
}

/**
 * Where a legal page (Terms, Privacy) sends its reader back to. Someone
 * signed in opened it from the app's footer, so they go back to the page
 * they came from; anyone else goes back to sign in, with the page they
 * were trying to reach still attached.
 */
export function legalBackLink(callbackUrl: string | null | undefined, signedIn: boolean): LegalBackLink {
    return signedIn
        ? { href: safeCallbackPath(callbackUrl), label: "Back to Atlas Wealth" }
        : { href: withCallback("/login", callbackUrl), label: "Back to sign in" };
}
