import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import { withCallback } from "@/lib/auth/callback-url";

export const metadata: Metadata = {
    title: "Privacy Policy | Atlas Wealth",
    description: "What Atlas Wealth collects, why, who it is shared with, and how to have it deleted.",
};

// Google's consent screen and Plaid's application profile both link here, so
// the page is public (see isPublicRoute in src/proxy.ts) and renders without
// the app chrome (src/components/layout/AppFrame.tsx).
const CONTACT_EMAIL = "ashwath.ravi@gmail.com";
const LAST_UPDATED = "October 26, 2026";
const PLAID_PRIVACY_URL = "https://plaid.com/legal/#end-user-privacy-policy";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PrivacyPage({ searchParams }: { searchParams: SearchParams }) {
    // Opened from the sign-in page, the policy sends people back with the
    // page they were trying to reach still attached.
    const { callbackUrl } = await searchParams;
    const backToSignIn = withCallback("/login", Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl);

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
                    <h1 id="pm-legal-title">Privacy Policy</h1>
                    <p className="pm-legal-updated">Last updated {LAST_UPDATED}</p>
                    <p>
                        Atlas Wealth is a personal investment tracking app, currently in an invite-only beta.
                        This policy explains what it collects, why, who it is shared with, and how to have it
                        deleted. Questions go to <ContactLink />.
                    </p>
                </header>

                <section aria-labelledby="privacy-collect">
                    <h2 id="privacy-collect">What we collect</h2>
                    <ul>
                        <li>
                            <strong>Your Google account basics.</strong> When you sign in with Google we receive
                            your name, email address, profile picture and Google account ID. We ask only for
                            these, so Atlas Wealth cannot read your Gmail, Drive, contacts or anything else in
                            your Google account. Google also returns sign-in tokens that we store with your
                            account record; they only allow reading those same basics and expire within an
                            hour, and we don&rsquo;t ask Google for long-lived access.
                        </li>
                        <li>
                            <strong>Accounts you link through Plaid.</strong> If you connect a brokerage or bank,
                            Plaid sends us the institution name, account names and types, the last four digits
                            of account numbers, balances, holdings and investment transactions. For each
                            investment account you choose to connect, we keep its holdings, cash and up to two
                            years of its investment transactions as an account in Atlas Wealth, refreshed each
                            weekday evening and whenever you choose Sync now; accounts you don&rsquo;t choose
                            aren&rsquo;t synced. You sign in to your institution through Plaid, so we never see or
                            store your bank username or password.
                        </li>
                        <li>
                            <strong>Data you add.</strong> Portfolios, holdings and transactions you import from
                            CSV or enter by hand, your watchlist (tickers, why they&rsquo;re on it, target prices and
                            notes), your decision journal, your research theses (with their catalysts and evidence
                            links), the questions you ask Ask and its answers (the last 25 of each), and the SEC
                            filers you add to Alpha Radar. During the beta,
                            Alpha Radar&rsquo;s list of filers and any notes on them are shared by every account,
                            so don&rsquo;t put anything private there.
                        </li>
                        <li>
                            <strong>Your settings.</strong> Profile, display, notification and trading
                            preferences, the account names, last four digits and balances shown in Settings, and
                            your risk policy, including cash, employer-stock and tax-limit details. They are
                            saved with your account so they follow you to any browser; this browser keeps a copy
                            until you sign out. API keys you enter in Settings are never saved: they&rsquo;re held
                            in memory for the current session only.
                        </li>
                        <li>
                            <strong>Sign-in cookies and request logs.</strong> A session cookie keeps you signed
                            in, and Auth.js sets short-lived cookies to secure the sign-in itself. Our hosting
                            provider records standard request logs (IP address, browser and time) that we use
                            for security and debugging.
                        </li>
                    </ul>
                    <p>
                        Some things are stored only in your browser, not on our servers: price alerts and their
                        notes, and weekly reviews.
                        Each account that signs in on this browser gets its own copy, and clearing this
                        site&rsquo;s data removes them. Someone with access to this browser profile could still
                        read them. To show prices, the ticker symbols in your watchlist and theses are sent to
                        our server and on to the market data provider.
                    </p>
                    <p>We do not use advertising or analytics cookies, tracking pixels or third-party trackers.</p>
                </section>

                <section aria-labelledby="privacy-use">
                    <h2 id="privacy-use">How we use it</h2>
                    <ul>
                        <li>To run the app: show your net worth, holdings, activity and performance, and check trade ideas against your risk policy.</li>
                        <li>To keep it secure: sign-in, limiting request rates, and investigating misuse.</li>
                        <li>To fix problems and to contact you about your account.</li>
                    </ul>
                    <p>
                        We do not sell your data, use it for advertising, or use it to make credit decisions.
                        Atlas Wealth does not place trades or move money. Ask answers questions inside Atlas
                        Wealth itself; your questions are not sent to an outside AI service.
                    </p>
                </section>

                <section aria-labelledby="privacy-share">
                    <h2 id="privacy-share">Who we share it with</h2>
                    <p>Only the services that run Atlas Wealth, and only what each one needs:</p>
                    <ul>
                        <li>
                            <strong>Plaid</strong> connects your financial accounts. Plaid&rsquo;s handling of
                            your data is described in the{" "}
                            <a href={PLAID_PRIVACY_URL} target="_blank" rel="noreferrer">
                                Plaid End User Privacy Policy
                            </a>
                            .
                        </li>
                        <li><strong>Google</strong> handles sign-in.</li>
                        <li><strong>Vercel</strong> hosts the app.</li>
                        <li>
                            <strong>Upstash</strong> keeps short-lived request counters that limit how often
                            each visitor can call the app. They are keyed by your IP address or account ID and
                            the page called, and expire within minutes.
                        </li>
                        <li><strong>Supabase</strong> hosts the database.</li>
                        <li>
                            <strong>Sentry</strong> receives a report when something in the app breaks: the error,
                            where in the app it happened (including the pages visited just before), the request ID,
                            and your browser and device type. Reports never include your name, email, cookies, what
                            you typed or your account details. Your browser sends its reports to Sentry directly, so
                            Sentry sees your IP address the way any website you connect to does.
                        </li>
                        <li>
                            <strong>Market data providers and SEC EDGAR</strong> supply prices and filings. We
                            send them ticker symbols, filer IDs and the words you type into ticker search, never
                            your name, email or account details.
                        </li>
                    </ul>
                    <p>
                        We may also disclose information when the law requires it, or to protect the safety of
                        users or the service. We share it with no one else.
                    </p>
                </section>

                <section aria-labelledby="privacy-retention">
                    <h2 id="privacy-retention">Keeping and deleting your data</h2>
                    <p>
                        We keep your data while your account is open. Email <ContactLink /> to delete your
                        account: within 30 days we remove your account, linked-account data (including our
                        encrypted access to your institutions), portfolios, transactions, watchlist, journal,
                        theses, Ask questions and settings from our database,
                        unless the law requires us to keep something.
                    </p>
                    <p>
                        When you remove a watchlist ticker or delete a journal entry or thesis, its notes and
                        reasoning are erased straight away. A short record stays (the ticker and its dates, and
                        for a journal entry or thesis its type, outcome or status, and conviction) so your other
                        devices know it was removed; it goes when your account does.
                    </p>
                    <p>
                        When you clear your Ask conversation it disappears straight away. Its questions and answers
                        are deleted once they&rsquo;re a day old, by the next nightly cleanup (each weekday
                        evening): until then they count towards the day&rsquo;s question limit. Older questions
                        are deleted the same way once you have more than 25.
                    </p>
                    <p>
                        Plaid keeps its own record of each connection under its policy. To end it, disconnect it
                        in Settings (which also ends it at Plaid and erases our token for it), or remove Atlas
                        Wealth through your institution or at{" "}
                        <a href="https://my.plaid.com" target="_blank" rel="noreferrer">my.plaid.com</a>. To stop
                        syncing a single account, delete it on the Accounts page: its holdings and transactions
                        go with it, and it isn&rsquo;t synced again. Data kept in your browser is removed when you
                        clear this site&rsquo;s data.
                    </p>
                </section>

                <section aria-labelledby="privacy-security">
                    <h2 id="privacy-security">Security</h2>
                    <p>
                        All traffic is encrypted in transit. The tokens Plaid issues for your linked accounts
                        are encrypted again before they are stored. The database refuses its public data
                        interfaces, and the app reaches it through a restricted role that cannot change its
                        structure. Every query for your portfolios, holdings, transactions and linked accounts is limited
                        to your account in the app&rsquo;s code, and automated tests check that one account cannot
                        read another&rsquo;s. Alpha Radar&rsquo;s filer list is the exception: it is shared during
                        the beta. No system is perfectly secure; if a breach affects your data we will tell you
                        promptly.
                    </p>
                </section>

                <section aria-labelledby="privacy-rights">
                    <h2 id="privacy-rights">Your choices</h2>
                    <p>
                        You can ask for a copy of your data, ask us to correct it, or ask us to delete it by
                        emailing <ContactLink />. We reply within 30 days.
                    </p>
                </section>

                <section aria-labelledby="privacy-children">
                    <h2 id="privacy-children">Children</h2>
                    <p>Atlas Wealth is not meant for anyone under 18, and we do not knowingly collect their data.</p>
                </section>

                <section aria-labelledby="privacy-changes">
                    <h2 id="privacy-changes">Changes to this policy</h2>
                    <p>
                        When this policy changes we update the date at the top. If a change affects how your
                        data is used or shared, we email you before it takes effect.
                    </p>
                </section>

                <footer className="pm-legal-footer">
                    <Link href={backToSignIn}>Back to sign in</Link>
                </footer>
            </article>
        </div>
    );
}

function ContactLink() {
    return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}
