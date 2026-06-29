import Link from "next/link";
import { ArrowRight, BookOpen, BrainCircuit, CalendarClock, LineChart, Radar, ShieldCheck } from "lucide-react";
import { PageHeaderSync } from "@/components/layout/TopBar";

const SURFACE_LINKS = [
    { href: "/research?tab=alpha-radar", label: "Open Alpha Radar in Research" },
    { href: "/", label: "View the Dashboard card" },
    { href: "/settings?tab=alerts", label: "Configure alert rules" },
    { href: "/settings?tab=notifications", label: "Configure delivery" },
];

const V1_RELEASE_NOTES = [
    "Use tracked filers to monitor a focused set of 13F managers and their latest filing status.",
    "Ingest SEC filing metadata and normalize 13F information-table holdings.",
    "Compare quarters to identify new positions, exits, large adds, trims, and unchanged holdings.",
    "Generate deterministic research memos that cite source filings and ranked changes.",
    "Surface Alpha Radar in Research, Dashboard, notifications, and settings.",
    "Trigger in-app alerts when material changes overlap with holdings, watchlist names, or active theses.",
];

const V1_WORKFLOWS = [
    {
        title: "Read a tracked filer",
        steps: [
            "Open Research and select the Alpha Radar tab.",
            "Pick a filer from the left column to load the latest report.",
            "Start with Material 13F changes, then read memo sections for the source-backed explanation.",
        ],
    },
    {
        title: "Refresh filing data",
        steps: [
            "Use Refresh from Research or the Dashboard card when local database and SEC access are configured.",
            "Treat seeded data as a local fallback until live storage is available.",
            "Review failures before retrying so duplicate runs do not create duplicate alerts.",
        ],
    },
    {
        title: "Act on an alert",
        steps: [
            "Create Alpha Radar alert rules from Settings.",
            "Use materiality score thresholds to avoid low-signal notifications.",
            "Open the linked Research context before changing a thesis or portfolio action.",
        ],
    },
];

const V2_RELEASE_NOTES = [
    "Agent boundaries now separate scheduling, ingestion, parsing, diffing, thesis generation, notifications, semantic search, and UI reads.",
    "Semantic filing memory searches filings, memo sections, and generated thesis evidence with keyword fallback when embeddings are disabled.",
    "Clone tracking shows where multiple filers are moving into the same names and where those moves overlap with the user's portfolio context.",
    "Conviction ranking separates raw 13F signal strength, user relevance, and evidence fit.",
    "External overlays add cited context such as insider activity, valuation, transcript sentiment, and thematic exposure without replacing source 13F facts.",
    "Why-now thesis drafts, scheduled orchestration, exploratory backtests, and run operations are now visible in the Alpha Radar workflow.",
];

const V2_WORKFLOWS = [
    {
        title: "Run agentic research",
        steps: [
            "Use the scheduled orchestration panel to confirm queued jobs and last-run status.",
            "Review Run operations before trusting a refresh if provider budgets, failures, or retries are degraded.",
            "Use in-app delivery first; external channels remain adapter-gated until destinations are approved.",
        ],
    },
    {
        title: "Review advanced evidence",
        steps: [
            "Search Evidence memory for a company, theme, filer, or quarter.",
            "Compare clone clusters and conviction components before promoting an idea.",
            "Use external overlays as corroboration, not as a replacement for source 13F facts.",
        ],
    },
    {
        title: "Validate a thesis candidate",
        steps: [
            "Open Thesis drafts and inspect hypothesis, why-now, falsify-if, risks, and citations.",
            "Check Exploratory backtest for delayed 13F signal quality, not trading advice.",
            "Accept, edit, or archive a draft only after reviewing the cited evidence.",
        ],
    },
];

const LIMITATIONS = [
    "13F filings are delayed and do not show shorts, non-reportable assets, or intra-quarter trades.",
    "Fallback data is seeded for local development and should not be treated as live market intelligence.",
    "Backtests are exploratory signal-quality checks and are not production trading recommendations.",
    "External overlays and generated drafts require human review before they affect active theses or portfolio decisions.",
];

export default function HelpPage() {
    return (
        <>
            <PageHeaderSync
                title="Help"
                subtitle="Release notes and operating guides"
                crumbs={["System", "Help"]}
            />
            <main className="pm-help" data-testid="help-page">
                <section className="pm-help-intro" aria-labelledby="help-heading">
                    <div>
                        <span className="pm-help-eyebrow">Portfolio Manager Help</span>
                        <h1 id="help-heading">Alpha Radar release notes and guide</h1>
                        <p>
                            Learn what shipped in Alpha Radar v1 and v2, where to find each workflow, and what limits to keep in mind before acting on a 13F signal.
                        </p>
                    </div>
                    <div className="pm-help-link-grid" aria-label="Alpha Radar surface links">
                        {SURFACE_LINKS.map((link) => (
                            <Link key={link.href} href={link.href} className="pm-help-surface-link">
                                <span>{link.label}</span>
                                <ArrowRight size={14} aria-hidden="true" />
                            </Link>
                        ))}
                    </div>
                </section>

                <nav className="pm-help-version-nav" aria-label="Alpha Radar help sections">
                    <a href="#alpha-radar-v1">Alpha Radar v1</a>
                    <a href="#alpha-radar-v2">Alpha Radar v2</a>
                    <a href="#alpha-radar-limits">Data and decision limits</a>
                </nav>

                <ReleaseSection
                    id="alpha-radar-v1"
                    eyebrow="13F Research MVP"
                    title="Alpha Radar v1"
                    description="The first usable 13F research workflow: track filers, parse filings, compare quarters, read memos, and receive material-change alerts."
                    Icon={Radar}
                    notes={V1_RELEASE_NOTES}
                    workflows={V1_WORKFLOWS}
                    testId="alpha-radar-help-v1"
                />

                <ReleaseSection
                    id="alpha-radar-v2"
                    eyebrow="Agentic Research Architecture"
                    title="Alpha Radar v2"
                    description="The advanced research layer: orchestrated runs, semantic memory, clone tracking, conviction ranking, thesis drafts, backtests, and operations guardrails."
                    Icon={BrainCircuit}
                    notes={V2_RELEASE_NOTES}
                    workflows={V2_WORKFLOWS}
                    testId="alpha-radar-help-v2"
                />

                <section id="alpha-radar-limits" className="pm-help-section" aria-labelledby="alpha-radar-limits-heading">
                    <div className="pm-help-section-head">
                        <div className="pm-help-section-icon" aria-hidden="true">
                            <ShieldCheck size={20} />
                        </div>
                        <div>
                            <span className="pm-help-eyebrow">Decision boundaries</span>
                            <h2 id="alpha-radar-limits-heading">Data freshness and maturity notes</h2>
                            <p>Use Alpha Radar as research context. Do not treat delayed filings, generated drafts, overlays, or backtests as automatic trade instructions.</p>
                        </div>
                    </div>
                    <div className="pm-help-note-grid">
                        {LIMITATIONS.map((item) => (
                            <div key={item} className="pm-help-note">
                                {item}
                            </div>
                        ))}
                    </div>
                </section>
            </main>
        </>
    );
}

function ReleaseSection({
    id,
    eyebrow,
    title,
    description,
    Icon,
    notes,
    workflows,
    testId,
}: {
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    Icon: typeof Radar;
    notes: string[];
    workflows: Array<{ title: string; steps: string[] }>;
    testId: string;
}) {
    return (
        <section id={id} className="pm-help-section" aria-labelledby={`${id}-heading`} data-testid={testId}>
            <div className="pm-help-section-head">
                <div className="pm-help-section-icon" aria-hidden="true">
                    <Icon size={20} />
                </div>
                <div>
                    <span className="pm-help-eyebrow">{eyebrow}</span>
                    <h2 id={`${id}-heading`}>{title}</h2>
                    <p>{description}</p>
                </div>
            </div>

            <div className="pm-help-two-col">
                <div className="pm-help-panel">
                    <h3>
                        <BookOpen size={16} aria-hidden="true" />
                        Release notes
                    </h3>
                    <ul className="pm-help-check-list">
                        {notes.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </div>

                <div className="pm-help-panel">
                    <h3>
                        <LineChart size={16} aria-hidden="true" />
                        How to use it
                    </h3>
                    <div className="pm-help-workflow-list">
                        {workflows.map((workflow) => (
                            <article key={workflow.title} className="pm-help-workflow">
                                <h4>{workflow.title}</h4>
                                <ol>
                                    {workflow.steps.map((step) => (
                                        <li key={step}>{step}</li>
                                    ))}
                                </ol>
                            </article>
                        ))}
                    </div>
                </div>
            </div>

            <div className="pm-help-preview" aria-label={`${title} screen guide`}>
                <CalendarClock size={16} aria-hidden="true" />
                <span>
                    Screen guide: Research shows the full Alpha Radar workflow; Dashboard summarizes latest reports; Settings controls alerts and delivery.
                </span>
            </div>

            <div className="pm-help-action-row">
                <Link href="/research?tab=alpha-radar" className="pm-btn pm-btn-primary">
                    Open Research
                </Link>
                <Link href="/settings?tab=alerts" className="pm-btn pm-btn-secondary">
                    Alert settings
                </Link>
                <Link href="/settings?tab=notifications" className="pm-btn pm-btn-secondary">
                    Delivery settings
                </Link>
                <Link href="/" className="pm-btn pm-btn-secondary">
                    Dashboard
                </Link>
            </div>
        </section>
    );
}
