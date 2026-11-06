import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { WeeklyReview } from "@/lib/reviews/types";

import {
    ALERTS_LISTED,
    alertsEmail,
    escapeHtml,
    formatDayRange,
    siteLink,
    unsubscribeHeaders,
    unsubscribeUrls,
    weeklyReviewEmail,
    type EmailedAlert,
} from "./templates";

const LINKS = { siteUrl: "https://atlas.example.test", token: "tok_en-123" };

const AAPL: EmailedAlert = {
    message: "AAPL closed at $210.00 on Nov 2, at or above $200.00.",
    metric: "price",
    symbol: "AAPL",
    href: "/portfolios/detail/AAPL",
};

const REVIEW: WeeklyReview = {
    id: "wk:2026-10-26",
    weekStart: "2026-10-26T04:00:00.000Z",
    weekEnd: "2026-10-30T20:00:00.000Z",
    firstDay: "2026-10-26",
    lastDay: "2026-10-30",
    narrative: "You closed 2 trades for +$1,234 realized.",
    stats: {
        realizedPnlUsd: 1234.4,
        navPctChange: 0.49,
        ruleAdherence: 80,
        exceptions: 1,
        policyExceptions: 0,
        sellDisciplineEvents: 0,
        churnWarnings: 0,
        churnSymbols: [],
        tradeCount: { buy: 0, sell: 2, rebalance: 0, total: 2 },
        bestDecision: { tradeId: "t-1", label: "SELL 10 AAPL", impactUsd: 900 },
    },
};

describe("unsubscribe links (launch item i58)", () => {
    test("the footer opens a page that asks; mail apps post to the one-click address", () => {
        const urls = unsubscribeUrls(LINKS, "alerts");
        assert.deepEqual(urls, {
            page: "https://atlas.example.test/unsubscribe?token=tok_en-123&list=alerts",
            oneClick: "https://atlas.example.test/api/email/unsubscribe?token=tok_en-123&list=alerts",
        });
        assert.deepEqual(unsubscribeHeaders(urls), {
            "List-Unsubscribe": "<https://atlas.example.test/api/email/unsubscribe?token=tok_en-123&list=alerts>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        });
    });
});

describe("siteLink", () => {
    test("makes a path on the site absolute, and nothing else", () => {
        assert.equal(siteLink(LINKS.siteUrl, "/portfolios/detail/AAPL"), "https://atlas.example.test/portfolios/detail/AAPL");
        assert.equal(siteLink(LINKS.siteUrl, "/research?tab=alpha-radar"), "https://atlas.example.test/research?tab=alpha-radar");
        for (const href of [null, "", "https://evil.test/", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "portfolios"]) {
            assert.equal(siteLink(LINKS.siteUrl, href), null, String(href));
        }
    });
});

describe("escapeHtml", () => {
    test("escapes what could start markup or end an attribute", () => {
        assert.equal(escapeHtml(`<a href="x">Tom's & co</a>`), "&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;");
    });
});

describe("alertsEmail", () => {
    test("one alert: the subject names its ticker or kind and no amount; the body says it all, with a link and a way out", () => {
        const email = alertsEmail([AAPL], LINKS);
        assert.equal(email.subject, "Your AAPL alert");
        assert.equal(alertsEmail([{ ...AAPL, metric: "portfolio_value", symbol: null, message: "Your accounts closed at $105,000.00 on Oct 30." }], LINKS).subject, "Your accounts alert");
        assert.equal(alertsEmail([{ ...AAPL, metric: "alpha_radar_exit", symbol: null }], LINKS).subject, "Your Alpha Radar alert");
        assert.ok(!email.html.includes("display:none;max-height:0;overflow:hidden\">AAPL"), "the inbox preview says no amount either");
        assert.ok(email.html.includes("One of your alert rules fired."));
        assert.ok(email.html.includes("AAPL closed at $210.00 on Nov 2, at or above $200.00."));
        assert.match(email.html, /<h1[^>]*>Your alert<\/h1>/);
        assert.ok(email.html.includes('<a href="https://atlas.example.test/portfolios/detail/AAPL"'));
        assert.ok(email.html.includes(">Open AAPL</a>"));
        assert.ok(email.html.includes('href="https://atlas.example.test/unsubscribe?token=tok_en-123&amp;list=alerts"'));
        assert.ok(email.html.includes('href="https://atlas.example.test/settings#email"'));
        assert.ok(email.html.includes("never live"));
        assert.ok(email.html.includes("isn&rsquo;t investment advice"));
        assert.ok(email.text.includes("- AAPL closed at $210.00 on Nov 2, at or above $200.00."));
        assert.ok(email.text.includes("  Open AAPL: https://atlas.example.test/portfolios/detail/AAPL"));
        assert.ok(email.text.includes("Unsubscribe: https://atlas.example.test/unsubscribe?token=tok_en-123&list=alerts"));
    });

    test("several: counted in the subject, never with amounts; past the first 20 they're counted, not listed", () => {
        const alerts = Array.from({ length: ALERTS_LISTED + 3 }, (_, i): EmailedAlert => ({
            message: `Alert number ${i + 1}.`,
            metric: i % 2 ? "portfolio_value" : "alpha_radar_exit",
            symbol: null,
            href: i % 2 ? "/portfolios/holdings" : null,
        }));
        const email = alertsEmail(alerts, LINKS);
        assert.equal(email.subject, "23 alerts from Atlas Wealth");
        assert.ok(email.html.includes("Alert number 20."));
        assert.ok(!email.html.includes("Alert number 21."));
        assert.ok(email.html.includes("And 3 more in the app."));
        assert.ok(email.text.includes("And 3 more in the app."));
        assert.ok(email.html.includes(">Open holdings</a>"));
        assert.ok(!email.html.includes("Open Alpha Radar"), "an alert without a link gets none");
    });

    test("what an alert says is escaped, and a link off the site is dropped", () => {
        const email = alertsEmail([{ ...AAPL, message: "Fund <script>x</script> & co opened CB.", href: "https://evil.test/" }], LINKS);
        assert.ok(email.html.includes("Fund &lt;script&gt;x&lt;/script&gt; &amp; co opened CB."));
        assert.ok(!email.html.includes("<script>"));
        assert.ok(!email.html.includes("evil.test"));
    });
});

describe("weeklyReviewEmail", () => {
    test("the week as Today shows it, with no amounts in the subject", () => {
        const email = weeklyReviewEmail(REVIEW, [], LINKS);
        assert.equal(email.subject, "Your weekly review: Oct 26–30");
        assert.ok(email.html.includes("Week of Oct 26–30"));
        for (const text of [email.html, email.text]) {
            assert.ok(text.includes("+$1,234"), "realized P&L in whole dollars");
            assert.ok(text.includes("+0.49% of net worth · 2 closed trades"));
            assert.ok(text.includes("80/100"));
            assert.ok(text.includes("1 exception"));
            assert.ok(text.includes("SELL 10 AAPL"));
            assert.ok(text.includes("+$900 impact"));
            assert.ok(text.includes("You closed 2 trades for +$1,234 realized."));
        }
        assert.ok(email.html.includes('href="https://atlas.example.test/unsubscribe?token=tok_en-123&amp;list=weekly_review"'));
        assert.ok(email.text.includes("Reflect on Today: https://atlas.example.test/"));
        assert.ok(!email.html.includes("Not counted"));
    });

    test("a loss, no net worth, no reasons and no winner read as Today's card does; left-out tickers are named", () => {
        const email = weeklyReviewEmail({
            ...REVIEW,
            stats: { ...REVIEW.stats, realizedPnlUsd: -250.6, navPctChange: null, ruleAdherence: null, bestDecision: undefined, tradeCount: { buy: 0, sell: 1, rebalance: 0, total: 1 } },
        }, ["NVDA"], LINKS);
        assert.ok(email.text.includes("Realized P&L: −$251 (1 closed trade)"));
        assert.ok(email.text.includes("Rule adherence: — (No reasons recorded on Trade)"));
        assert.ok(email.text.includes("Best decision: — (No winning trades closed)"));
        assert.ok(email.text.includes("Not counted: trades in NVDA"));
    });
});

describe("formatDayRange", () => {
    test("writes a week as Today's card does", () => {
        assert.equal(formatDayRange("2026-10-26", "2026-10-30"), "Oct 26–30");
        assert.equal(formatDayRange("2026-09-28", "2026-10-02"), "Sep 28 – Oct 2");
    });
});
