/**
 * The emails the nightly email job sends (launch item i58): the alerts the
 * user's rules raised, and the weekly review of their closed trades. Each
 * comes as HTML and plain text, with a footer saying why it came and how to
 * stop it.
 *
 * Unsubscribing takes one click from a mail app (RFC 8058: a POST to the
 * List-Unsubscribe address) or a page with a button from the footer link;
 * opening a link never unsubscribes, since mail scanners open links.
 * Subjects carry no amounts: they show on lock screens.
 */

import { alertLinkLabel, isAlphaRadarAlertMetric } from "@/lib/alerts/metrics";
import type { AlertMetric } from "@/lib/alerts/types";
import { formatPct, formatUsd } from "@/lib/format";
import type { WeeklyReview } from "@/lib/reviews/types";
import type { EmailList } from "@/lib/validators/email";

/** Alerts listed in one email; the rest are counted, and are in the app. */
export const ALERTS_LISTED = 20;

export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
}

export interface EmailLinks {
    /** The site's origin. */
    siteUrl: string;
    /** The recipient's unsubscribe token. */
    token: string;
}

export interface UnsubscribeUrls {
    /** The page the footer links to: it asks before unsubscribing. */
    page: string;
    /** Where a mail app's one-click unsubscribe posts. */
    oneClick: string;
}

export function unsubscribeUrls({ siteUrl, token }: EmailLinks, list: EmailList): UnsubscribeUrls {
    const query = `token=${encodeURIComponent(token)}&list=${list}`;
    return { page: `${siteUrl}/unsubscribe?${query}`, oneClick: `${siteUrl}/api/email/unsubscribe?${query}` };
}

/** The headers that give mail apps their one-click unsubscribe. */
export function unsubscribeHeaders(urls: UnsubscribeUrls): Record<string, string> {
    return {
        "List-Unsubscribe": `<${urls.oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** A path on the site as an absolute link; null for anything that would leave it. */
export function siteLink(siteUrl: string, path: string | null | undefined): string | null {
    if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
    try {
        const url = new URL(path, siteUrl);
        return url.origin === siteUrl ? url.toString() : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const COLORS = { text: "#1f2933", muted: "#5f6b7a", border: "#e3e8ee", accent: "#0f7a3d", pos: "#0f7a3d", neg: "#b42318" };

function button(href: string, label: string): string {
    return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:6px">${escapeHtml(label)}</a>`;
}

function layout({ title, preheader, body, footer }: { title: string; preheader: string; body: string; footer: string }): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fa">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:${COLORS.text}">
<p style="margin:0 0 16px;font-weight:700;font-size:14px;letter-spacing:0.02em">Atlas Wealth</p>
<div style="background:#ffffff;border:1px solid ${COLORS.border};border-radius:8px;padding:24px">
${body}
</div>
<div style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:${COLORS.muted}">
${footer}
</div>
</div>
</body>
</html>`;
}

interface Footer {
    why: string;
    urls: UnsubscribeUrls;
    settingsUrl: string;
}

function footerHtml({ why, urls, settingsUrl }: Footer): string {
    return [
        `<p style="margin:0 0 8px">${escapeHtml(why)} <a href="${escapeHtml(urls.page)}" style="color:${COLORS.muted}">Unsubscribe</a> · <a href="${escapeHtml(settingsUrl)}" style="color:${COLORS.muted}">Email settings</a></p>`,
        `<p style="margin:0">Prices are each day&rsquo;s closing prices, never live. Atlas Wealth isn&rsquo;t investment advice and never places trades.</p>`,
    ].join("\n");
}

function footerText({ why, urls, settingsUrl }: Footer): string {
    return [
        "--",
        why,
        `Unsubscribe: ${urls.page}`,
        `Email settings: ${settingsUrl}`,
        "Prices are each day's closing prices, never live. Atlas Wealth isn't investment advice and never places trades.",
    ].join("\n");
}

function settingsUrl(siteUrl: string): string {
    return `${siteUrl}/settings#email`;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface EmailedAlert {
    message: string;
    metric: AlertMetric;
    symbol: string | null;
    href: string | null;
}

/** What one alert is about, for a subject: its ticker or its kind, never what it says. */
function alertSubject(alert: EmailedAlert): string {
    if (isAlphaRadarAlertMetric(alert.metric)) return "Your Alpha Radar alert";
    return alert.symbol ? `Your ${alert.symbol} alert` : "Your accounts alert";
}

/** The alerts raised since the last email, newest first. */
export function alertsEmail(alerts: readonly EmailedAlert[], links: EmailLinks): RenderedEmail {
    const listed = alerts.slice(0, ALERTS_LISTED);
    const more = alerts.length - listed.length;
    const subject = alerts.length === 1 ? alertSubject(alerts[0]) : `${alerts.length} alerts from Atlas Wealth`;
    const footer: Footer = {
        why: "You get this email because you turned on alert emails in Atlas Wealth.",
        urls: unsubscribeUrls(links, "alerts"),
        settingsUrl: settingsUrl(links.siteUrl),
    };
    const items = listed.map((alert) => ({ ...alert, link: siteLink(links.siteUrl, alert.href) }));
    const moreLine = more > 0 ? `And ${more} more in the app.` : null;

    const html = layout({
        title: subject,
        preheader: alerts.length === 1 ? "One of your alert rules fired." : `${alerts.length} of your alert rules fired.`,
        body: [
            `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${alerts.length === 1 ? "Your alert" : "Your alerts"}</h1>`,
            `<ul style="margin:0 0 16px;padding:0;list-style:none">`,
            ...items.map((item) => `<li style="padding:12px 0;border-top:1px solid ${COLORS.border}">${escapeHtml(item.message)}${item.link
                ? `<br><a href="${escapeHtml(item.link)}" style="color:${COLORS.accent};font-size:14px">${escapeHtml(alertLinkLabel(item.metric, item.symbol))}</a>`
                : ""}</li>`),
            `</ul>`,
            moreLine ? `<p style="margin:0 0 16px;color:${COLORS.muted}">${escapeHtml(moreLine)}</p>` : "",
            `<p style="margin:0">${button(`${links.siteUrl}/settings#notifications`, "Manage alert rules")}</p>`,
        ].filter(Boolean).join("\n"),
        footer: footerHtml(footer),
    });

    const text = [
        alerts.length === 1 ? "Your alert" : "Your alerts",
        "",
        ...items.flatMap((item) => [`- ${item.message}`, ...(item.link ? [`  ${alertLinkLabel(item.metric, item.symbol)}: ${item.link}`] : [])]),
        ...(moreLine ? ["", moreLine] : []),
        "",
        `Manage alert rules: ${links.siteUrl}/settings#notifications`,
        "",
        footerText(footer),
    ].join("\n");

    return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

/** "Oct 27–31" or "Sep 29 – Oct 3", from the week's Monday and Friday, as Today's card writes it. */
export function formatDayRange(firstDay: string, lastDay: string): string {
    const month = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const date = (day: string) => Number(day.slice(8, 10));
    return month(firstDay) === month(lastDay)
        ? `${month(firstDay)} ${date(firstDay)}–${date(lastDay)}`
        : `${month(firstDay)} ${date(firstDay)} – ${month(lastDay)} ${date(lastDay)}`;
}

function wholeDollars(value: number): string {
    return formatUsd(Math.round(value), { signed: true, decimals: 0 });
}

/**
 * The week's review as Today shows it: realized P&L, rule adherence, the
 * best decision and the summary. `leftOut` names tickers whose trades
 * couldn't be matched (a split), so the figures leave them out.
 */
export function weeklyReviewEmail(review: WeeklyReview, leftOut: readonly string[], links: EmailLinks): RenderedEmail {
    const { stats } = review;
    const range = formatDayRange(review.firstDay, review.lastDay);
    const subject = `Your weekly review: ${range}`;
    const trades = `${stats.tradeCount.total} closed ${stats.tradeCount.total === 1 ? "trade" : "trades"}`;
    const rows: Array<[string, string, string]> = [
        [
            "Realized P&L",
            wholeDollars(stats.realizedPnlUsd),
            stats.navPctChange === null ? trades : `${formatPct(stats.navPctChange, { signed: true, decimals: 2 })} of net worth · ${trades}`,
        ],
        [
            "Rule adherence",
            stats.ruleAdherence === null ? "—" : `${stats.ruleAdherence}/100`,
            stats.ruleAdherence === null
                ? "No reasons recorded on Trade"
                : `${stats.exceptions} ${stats.exceptions === 1 ? "exception" : "exceptions"}`,
        ],
        [
            "Best decision",
            stats.bestDecision?.label ?? "—",
            stats.bestDecision ? `${wholeDollars(stats.bestDecision.impactUsd)} impact` : "No winning trades closed",
        ],
    ];
    const leftOutLine = leftOut.length > 0
        ? `Not counted: trades in ${leftOut.join(", ")}, which couldn't be matched to their buys (a split, for example).`
        : null;
    const footer: Footer = {
        why: "You get this email because you turned on the weekly review email in Atlas Wealth.",
        urls: unsubscribeUrls(links, "weekly_review"),
        settingsUrl: settingsUrl(links.siteUrl),
    };

    const html = layout({
        title: subject,
        preheader: `Your closed trades for the week of ${range}.`,
        body: [
            `<h1 style="margin:0 0 4px;font-size:20px;line-height:1.3">Week of ${escapeHtml(range)}</h1>`,
            `<p style="margin:0 0 16px;color:${COLORS.muted};font-size:14px">Your weekly review, from the trades you closed.</p>`,
            `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">`,
            ...rows.map(([label, value, sub]) => `<tr><td style="padding:10px 0;border-top:1px solid ${COLORS.border};color:${COLORS.muted};font-size:14px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:10px 0;border-top:1px solid ${COLORS.border};text-align:right"><strong>${escapeHtml(value)}</strong><br><span style="color:${COLORS.muted};font-size:13px">${escapeHtml(sub)}</span></td></tr>`),
            `</table>`,
            `<p style="margin:0 0 16px"><strong>In short:</strong> ${escapeHtml(review.narrative)}</p>`,
            leftOutLine ? `<p style="margin:0 0 16px;color:${COLORS.muted};font-size:14px">${escapeHtml(leftOutLine)}</p>` : "",
            `<p style="margin:0">${button(`${links.siteUrl}/`, "Reflect on Today")}</p>`,
        ].filter(Boolean).join("\n"),
        footer: footerHtml(footer),
    });

    const text = [
        `Week of ${range}`,
        "Your weekly review, from the trades you closed.",
        "",
        ...rows.map(([label, value, sub]) => `${label}: ${value} (${sub})`),
        "",
        `In short: ${review.narrative}`,
        ...(leftOutLine ? ["", leftOutLine] : []),
        "",
        `Reflect on Today: ${links.siteUrl}/`,
        "",
        footerText(footer),
    ].join("\n");

    return { subject, html, text };
}
