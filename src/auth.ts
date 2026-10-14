import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import { db } from "@/db";
import {
    authAccounts,
    authAuthenticators,
    authSessions,
    authUsers,
    authVerificationTokens,
} from "@/db/schema";
import { isGoogleProfileAllowed, isSessionEmailAllowed } from "@/lib/auth/access";
import { SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "@/lib/auth/session-policy";

type AuthAdapterSchema = NonNullable<Parameters<typeof DrizzleAdapter<typeof db>>[1]>;

const authAdapterSchema = {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
    authenticatorsTable: authAuthenticators,
} as unknown as AuthAdapterSchema;

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: DrizzleAdapter(db, authAdapterSchema),
    session: {
        strategy: "database",
        maxAge: SESSION_MAX_AGE_SECONDS,
        updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    pages: {
        signIn: "/login",
        error: "/login",
    },
    providers: [
        Google({
            authorization: {
                params: {
                    scope: "openid email profile",
                },
            },
        }),
    ],
    callbacks: {
        async signIn({ account, profile }) {
            if (account?.provider !== "google") return false;
            return isGoogleProfileAllowed(profile);
        },
        async session({ session, user }) {
            // A session whose user has left the invite list carries no user,
            // which every caller treats as signed out.
            if (!isSessionEmailAllowed(user?.email)) {
                return { expires: session.expires };
            }
            if (session.user && user.id) {
                session.user.id = user.id;
            }
            return session;
        },
    },
});
