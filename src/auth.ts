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
import { isGoogleProfileAllowed, isOpenSignup } from "@/lib/auth/access";
import { admitNewAccount, hasGoogleAccount, signInDecision } from "@/lib/auth/new-accounts";
import { isSessionUserAllowed } from "@/lib/auth/session-access";
import { SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "@/lib/auth/session-policy";
import { seedNewUserSettings } from "@/lib/settings/server";

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
    events: {
        // First sign-in (launch item i43): a new user starts with example
        // data off, on their own (empty) numbers.
        async createUser({ user }) {
            if (user.id) await seedNewUserSettings(user.id);
        },
    },
    callbacks: {
        async signIn({ account, profile }) {
            if (account?.provider !== "google") return false;
            // Open sign-up takes at most the day's new accounts (launch item i77).
            return signInDecision(
                { allowed: isGoogleProfileAllowed(profile), openSignup: isOpenSignup() },
                {
                    isExistingAccount: () => hasGoogleAccount(account.providerAccountId),
                    admit: () => admitNewAccount(),
                },
            );
        },
        async session({ session, user }) {
            // A session whose user has left the invite list, or been blocked
            // (by email, or by their email's or Workspace's domain), carries
            // no user, which every caller treats as signed out.
            if (!(await isSessionUserAllowed(user))) {
                return { expires: session.expires };
            }
            if (session.user && user.id) {
                session.user.id = user.id;
            }
            return session;
        },
    },
});
