import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalDocument, type LegalSearchParams } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
    title: "Terms of Service | Atlas Wealth",
    description: "The terms for using Atlas Wealth, including why nothing in it is investment advice.",
};

const LAST_UPDATED = "October 27, 2026";
const PLAID_PRIVACY_URL = "https://plaid.com/legal/#end-user-privacy-policy";

export default function TermsPage({ searchParams }: { searchParams: LegalSearchParams }) {
    return (
        <LegalDocument
            title="Terms of Service"
            updated={LAST_UPDATED}
            related={{ href: "/privacy", label: "Privacy Policy" }}
            searchParams={searchParams}
            intro={
                <>
                    <p>
                        These terms cover your use of Atlas Wealth, a personal investment tracking app currently
                        in an invite-only beta. &ldquo;We&rdquo; means the person who runs Atlas Wealth, and
                        &ldquo;you&rdquo; means you. By signing in you agree to these terms.
                    </p>
                    <p>
                        In short: Atlas Wealth helps you keep track of your investments and check them against
                        rules you set. It doesn&rsquo;t give investment advice, and it never places trades.
                        Questions go to <ContactLink />.
                    </p>
                </>
            }
        >
            <section aria-labelledby="terms-using">
                <h2 id="terms-using">Using Atlas Wealth</h2>
                <ul>
                    <li>During the beta you need an invitation and a Google account to sign in.</li>
                    <li>You must be at least 18.</li>
                    <li>
                        Your account is for you alone. Keep your Google account secure: anyone who can sign in
                        to it can see your Atlas Wealth data.
                    </li>
                    <li>
                        Atlas Wealth is free during the beta. If that changes we&rsquo;ll tell you first, and
                        you won&rsquo;t be charged anything you haven&rsquo;t agreed to.
                    </li>
                </ul>
            </section>

            <section aria-labelledby="terms-advice">
                <h2 id="terms-advice">Not investment advice</h2>
                <p>
                    Nothing in Atlas Wealth is investment, financial, tax or legal advice, or a recommendation
                    to buy, sell or hold any security. That includes Today&rsquo;s list of what needs your
                    attention, the risk-policy and guardrail checks, the checks on orders you draft on Trade,
                    Ask&rsquo;s answers, Alpha Radar&rsquo;s summaries of SEC filings, strategies and
                    backtests, and anything labelled Sample, which is an illustration and not about your money.
                </p>
                <p>
                    We are not a registered investment adviser, broker-dealer or financial planner, and we
                    don&rsquo;t know your full financial situation. Every investment decision is yours. Past
                    performance, including a backtest&rsquo;s, doesn&rsquo;t predict future results. For advice
                    about your own situation, talk to a qualified professional.
                </p>
            </section>

            <section aria-labelledby="terms-trades">
                <h2 id="terms-trades">Atlas Wealth never places trades</h2>
                <p>
                    Atlas Wealth never places trades, routes orders, holds your money or moves it. An order you
                    draft on Trade is a plan saved for you to place yourself at your broker; marking it placed
                    only changes your record in Atlas Wealth. Accounts you link through Plaid are read-only to
                    us: we can read their balances, holdings and transactions, and can&rsquo;t act on them.
                </p>
            </section>

            <section aria-labelledby="terms-data">
                <h2 id="terms-data">Market data and accuracy</h2>
                <ul>
                    <li>
                        <strong>Prices</strong> come from{" "}
                        <a href="https://massive.com" target="_blank" rel="noreferrer">Massive</a> (formerly
                        Polygon.io). They are the latest closing prices we&rsquo;ve stored, not live quotes, so
                        a price can be a day or more old, or missing.
                    </li>
                    <li>
                        <strong>Filings</strong> come from{" "}
                        <a href="https://www.sec.gov/edgar" target="_blank" rel="noreferrer">SEC EDGAR</a>.
                        Managers file 13F reports up to 45 days after a quarter ends, so the positions they
                        describe may have changed since.
                    </li>
                    <li>
                        <strong>Your accounts</strong> are what you enter, import or link through Plaid, and are
                        only as complete and current as that source. Plaid&rsquo;s handling of what you link is
                        covered by the{" "}
                        <a href={PLAID_PRIVACY_URL} target="_blank" rel="noreferrer">
                            Plaid End User Privacy Policy
                        </a>
                        .
                    </li>
                </ul>
                <p>
                    Returns, attribution, risk checks and everything else Atlas Wealth works out depend on this
                    data, and any of it can be late, incomplete or wrong. Check the figures that matter with
                    your broker or the source before you act on them.
                </p>
            </section>

            <section aria-labelledby="terms-your-data">
                <h2 id="terms-your-data">Your data</h2>
                <p>
                    The data you add or link stays yours. You let us store and use it only to run Atlas Wealth
                    for you, as the <Link href="/privacy">Privacy Policy</Link> describes. You can download all
                    of it, or delete your account and everything in it, at any time in Settings. During the
                    beta, Alpha Radar&rsquo;s list of filers and any notes on them are shared by every account,
                    so don&rsquo;t put anything private there.
                </p>
            </section>

            <section aria-labelledby="terms-use">
                <h2 id="terms-use">Acceptable use</h2>
                <p>Please don&rsquo;t:</p>
                <ul>
                    <li>use Atlas Wealth to break the law or anyone else&rsquo;s rights;</li>
                    <li>try to reach another person&rsquo;s account or data, or parts of the service you weren&rsquo;t given;</li>
                    <li>
                        overload the service, get around its limits, or probe it for weaknesses (if you find a
                        security problem, please tell us at <ContactLink />);
                    </li>
                    <li>scrape it, or copy, resell or pass on its market data, which is for your personal use only;</li>
                    <li>share your account or let someone else use it.</li>
                </ul>
            </section>

            <section aria-labelledby="terms-beta">
                <h2 id="terms-beta">The beta</h2>
                <p>
                    Atlas Wealth is in beta. Features can change, break or go away, and data can be wrong or,
                    rarely, lost, so keep your broker&rsquo;s records as your own and download a copy of your
                    data in Settings from time to time. If we end the beta or shut Atlas Wealth down,
                    we&rsquo;ll email you at least 30 days before, so you have time to download your data.
                </p>
            </section>

            <section aria-labelledby="terms-ending">
                <h2 id="terms-ending">Ending your account</h2>
                <p>
                    You can stop using Atlas Wealth and delete your account at any time in Settings. We may
                    suspend or close an account that breaks these terms or puts the service or other people at
                    risk. Unless the law or someone&rsquo;s safety prevents it, we&rsquo;ll tell you why and
                    give you the chance to download your data first.
                </p>
            </section>

            <section aria-labelledby="terms-warranties">
                <h2 id="terms-warranties">No warranties</h2>
                <p>
                    Atlas Wealth is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. As far as the
                    law allows, we make no promises about it, express or implied, including that it will be
                    accurate, complete, uninterrupted, secure or fit for a particular purpose.
                </p>
            </section>

            <section aria-labelledby="terms-liability">
                <h2 id="terms-liability">Limits on liability</h2>
                <p>
                    As far as the law allows, we aren&rsquo;t liable for any investment loss, for decisions you
                    make or don&rsquo;t make using Atlas Wealth, or for indirect, incidental, special or
                    consequential damages, including lost profits or data. Our total liability for any claim
                    about Atlas Wealth is limited to the greater of what you paid us in the 12 months before
                    the claim and US$50. Some places don&rsquo;t allow these limits, so they apply to you only
                    as far as your law allows.
                </p>
            </section>

            <section aria-labelledby="terms-changes">
                <h2 id="terms-changes">Changes to these terms</h2>
                <p>
                    When these terms change we update the date at the top. If a change affects how you use
                    Atlas Wealth, we email you before it takes effect. Using Atlas Wealth after that means you
                    accept the new terms; if you don&rsquo;t, you can delete your account in Settings.
                </p>
            </section>

            <section aria-labelledby="terms-contact">
                <h2 id="terms-contact">Contact</h2>
                <p>Questions about these terms go to <ContactLink />.</p>
            </section>
        </LegalDocument>
    );
}
