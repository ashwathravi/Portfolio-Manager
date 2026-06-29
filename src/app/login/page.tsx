import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { auth, signIn } from "@/auth";
import { isAuthConfigured } from "@/lib/auth/access";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function LoginPage({
    searchParams,
}: {
    searchParams: SearchParams;
}) {
    const params = await searchParams;
    const callbackUrl = safeRedirectPath(readParam(params.callbackUrl) ?? "/");
    const error = readParam(params.error);

    if (isAuthConfigured()) {
        const session = await auth();
        if (session?.user) redirect(callbackUrl);
    }

    return (
        <div className="pm-login-page">
            <section className="pm-login-panel" aria-labelledby="pm-login-title">
                <div className="pm-login-brand">
                    <span className="pm-login-mark" aria-hidden="true">
                        AW
                    </span>
                    <span>Atlas Wealth</span>
                </div>

                <div className="pm-login-copy">
                    <ShieldCheck className="pm-login-icon" aria-hidden="true" />
                    <h1 id="pm-login-title">Sign in</h1>
                    <p>Use your Google account to open your Atlas Wealth workspace.</p>
                </div>

                {error && (
                    <p className="pm-login-error" role="alert">
                        Google sign-in was not approved for this workspace.
                    </p>
                )}

                <form
                    action={async () => {
                        "use server";
                        if (!isAuthConfigured()) redirect("/login?error=Configuration");
                        await signIn("google", { redirectTo: callbackUrl });
                    }}
                >
                    <button
                        type="submit"
                        className="pm-login-google"
                        disabled={!isAuthConfigured()}
                    >
                        <span className="pm-google-g" aria-hidden="true">G</span>
                        Continue with Google
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                </form>

                {!isAuthConfigured() && (
                    <p className="pm-login-hint">
                        Configure `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` to enable Google sign-in.
                    </p>
                )}
            </section>
        </div>
    );
}

function readParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function safeRedirectPath(value: string): string {
    if (!value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
