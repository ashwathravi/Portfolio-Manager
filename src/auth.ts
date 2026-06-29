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
import { isGoogleProfileAllowed } from "@/lib/auth/access";

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
    session: { strategy: "database" },
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
            if (session.user && user.id) {
                session.user.id = user.id;
            }
            return session;
        },
    },
});
