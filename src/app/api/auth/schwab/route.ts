import { type NextRequest, NextResponse } from "next/server";
import { schwabClient } from "@/lib/api/schwab/client";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
        return NextResponse.json({ error: "Failed to authorize with Charles Schwab." }, { status: 400 });
    }

    if (!code) {
        return NextResponse.json({ error: "Authorization code not provided." }, { status: 400 });
    }

    try {
        // Exchange the authorization code for an OAuth token
        const tokenResponse = await schwabClient.exchangeCodeForTokens(code);

        // TODO: Store tokenResponse.access_token and tokenResponse.refresh_token in the database securely for the user.
        // For now, we return it or redirect back to the app with a success flag

        // Redirect to a settings or dashboard page showing connection success
        return NextResponse.redirect(new URL("/settings?schwab_connected=true", req.url));

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Schwab OAuth Error:", errorMessage);
        return NextResponse.json({ error: "Failed to exchange authorization code for tokens." }, { status: 500 });
    }
}
