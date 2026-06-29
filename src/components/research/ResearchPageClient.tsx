"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuotesQuery } from "@/lib/api/market-data/queries";
import { useThesisStore } from "@/lib/research/useThesisStore";
import { useJournalStore } from "@/lib/research/useJournalStore";
import type { Thesis, ThesisDraft } from "@/lib/research/thesis";
import type { JournalEntry } from "@/lib/research/journal";
import { NewThesisModal } from "./NewThesisModal";
import { NewJournalEntryModal } from "./NewJournalEntryModal";
import { ThesisListCard } from "./ThesisListCard";
import { ThesisDetailPane } from "./ThesisDetailPane";
import {
    AlphaRadarDetailPane,
    AlphaRadarFilerColumn,
    useAlphaRadarResearchData,
} from "./AlphaRadarResearch";

/**
 * Phase 5 (AR-78) Research workspace wrapper.
 *
 * Master-detail layout. The left column hosts four tabs (Theses, Watchlist,
 * Journal, Archive) with counts + a filter input, then scrolls through the
 * matching list. The right column is the detail pane — `ThesisDetailPane`
 * (AR-79) renders the full hypothesis / falsify-if / FOR-AGAINST evidence /
 * catalysts / linked sources breakdown plus a mini price-since-open chart
 * with a target benchmark line for selected theses.
 *
 * Writes (create, edit, archive, restore, delete) round-trip through the
 * existing `useThesisStore` / `useJournalStore` hooks so localStorage-backed
 * state is preserved byte-for-byte from the old page.
 */

export type ResearchTabKey = "theses" | "watchlist" | "alphaRadar" | "journal" | "archive";

const TAB_LABEL: Record<ResearchTabKey, string> = {
    theses: "Theses",
    watchlist: "Watchlist",
    alphaRadar: "Alpha Radar",
    journal: "Journal",
    archive: "Archive",
};

// ---------------------------------------------------------------------------
// Seed watchlist — kept inline until a proper WatchlistStore lands. These
// are the same three tickers the old page rendered, so nothing regresses.
// ---------------------------------------------------------------------------

interface WatchlistItem {
    id: string;
    ticker: string;
    companyName: string;
    reason: string;
    dateAdded: string;
    currentPrice: number;
    targetEntry: number;
    notes: string;
}

const SEED_WATCHLIST: WatchlistItem[] = [
    {
        id: "w-coin",
        ticker: "COIN",
        companyName: "Coinbase Global, Inc.",
        reason: "Waiting for BTC ETF approval catalyst",
        dateAdded: "2024-01-15",
        currentPrice: 165.5,
        targetEntry: 145.0,
        notes: "Enter on pullback to $145 support level",
    },
    {
        id: "w-pltr",
        ticker: "PLTR",
        companyName: "Palantir Technologies Inc.",
        reason: "AI platform traction in commercial sector",
        dateAdded: "2024-01-22",
        currentPrice: 18.75,
        targetEntry: 16.5,
        notes: "Wait for next earnings to confirm commercial growth",
    },
    {
        id: "w-shop",
        ticker: "SHOP",
        companyName: "Shopify Inc.",
        reason: "E-commerce recovery + margin expansion",
        dateAdded: "2024-02-03",
        currentPrice: 72.3,
        targetEntry: 65.0,
        notes: "Target entry on market-wide pullback",
    },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResearchPageClient() {
    const searchParams = useSearchParams();
    const {
        active,
        archived,
        theses,
        create,
        update,
        remove,
        archive,
        restore,
    } = useThesisStore();
    const {
        entries: journalEntries,
        create: createJournal,
        update: updateJournal,
        remove: removeJournal,
    } = useJournalStore();

    const [tab, setTab] = useState<ResearchTabKey>(() => parseInitialTab(searchParams.get("tab")));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [thesisModalOpen, setThesisModalOpen] = useState(false);
    const [editingThesis, setEditingThesis] = useState<Thesis | null>(null);
    const [journalModalOpen, setJournalModalOpen] = useState(false);
    const [editingJournal, setEditingJournal] = useState<JournalEntry | null>(null);
    const alphaRadar = useAlphaRadarResearchData();

    const thesesById = useMemo(
        () => new Map(theses.map((t) => [t.id, t] as const)),
        [theses],
    );

    // Live watchlist quotes — same behavior the old WatchlistSection had.
    const watchSymbols = useMemo(
        () => SEED_WATCHLIST.map((w) => w.ticker),
        [],
    );
    const { data: watchQuotes } = useQuotesQuery(watchSymbols, {
        refetchInterval: 60_000,
        staleTime: 30_000,
    });

    // ---- Filtered lists (memoized so the scroll doesn't rebuild on rekey) ---
    const activeFiltered = useMemo(
        () => filterTheses(active, query),
        [active, query],
    );
    const archivedFiltered = useMemo(
        () => filterTheses(archived, query),
        [archived, query],
    );
    const watchlistFiltered = useMemo(
        () =>
            SEED_WATCHLIST.filter((w) => matchQuery(query, w.ticker, w.companyName, w.reason)),
        [query],
    );
    const journalFiltered = useMemo(
        () =>
            journalEntries.filter((e) =>
                matchQuery(query, e.ticker, e.decision, e.rationale),
            ),
        [journalEntries, query],
    );

    const counts: Record<ResearchTabKey, number> = {
        theses: active.length,
        watchlist: SEED_WATCHLIST.length,
        alphaRadar: alphaRadar.filers.length,
        journal: journalEntries.length,
        archive: archived.length,
    };

    const selectedThesisList = tab === "archive" ? archived : active;
    const effectiveSelectedId = selectedId && selectedThesisList.some((thesis) => thesis.id === selectedId)
        ? selectedId
        : selectedThesisList[0]?.id ?? null;
    const selectedThesis =
        effectiveSelectedId && thesesById.has(effectiveSelectedId)
            ? thesesById.get(effectiveSelectedId) ?? null
            : null;

    // ---- Handlers -----------------------------------------------------------
    const openCreate = () => {
        setEditingThesis(null);
        setThesisModalOpen(true);
    };
    const openEdit = (t: Thesis) => {
        setEditingThesis(t);
        setThesisModalOpen(true);
    };
    const handleDelete = (t: Thesis) => {
        if (
            typeof window !== "undefined" &&
            !window.confirm(`Delete thesis for ${t.ticker}? This cannot be undone.`)
        ) {
            return;
        }
        remove(t.id);
        if (selectedId === t.id) setSelectedId(null);
        toast.success(`Thesis for ${t.ticker} deleted.`);
    };
    const handleArchive = (t: Thesis) => {
        archive(t.id);
        if (selectedId === t.id) setSelectedId(null);
        toast(`Thesis for ${t.ticker} archived.`);
    };
    const handleRestore = (t: Thesis) => {
        restore(t.id);
        toast(`Thesis for ${t.ticker} restored.`);
        setTab("theses");
    };
    const submitThesis = (draft: ThesisDraft) => {
        if (editingThesis) update(editingThesis.id, draft);
        else create(draft);
    };
    const openCreateJournal = () => {
        setEditingJournal(null);
        setJournalModalOpen(true);
    };
    const handleDeleteJournal = (entry: JournalEntry) => {
        if (
            typeof window !== "undefined" &&
            !window.confirm(`Delete journal entry for ${entry.ticker}? This cannot be undone.`)
        ) {
            return;
        }
        removeJournal(entry.id);
        toast.success(`Journal entry for ${entry.ticker} deleted.`);
    };

    // Action button varies by tab to match the surface the user is in.
    const topbarAction =
        tab === "journal" ? (
            <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={openCreateJournal}
            >
                <Plus size={14} aria-hidden="true" />
                <span>New entry</span>
            </button>
        ) : tab === "watchlist" || tab === "alphaRadar" ? null : (
            <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={openCreate}
            >
                <Plus size={14} aria-hidden="true" />
                <span>New thesis</span>
            </button>
        );

    return (
        <div className="pm-research-stack">
            <header className="pm-research-topbar">
                <div>
                    <nav className="pm-crumbs" aria-label="Breadcrumb">
                        <Link href="/">Workspace</Link>
                        <span className="pm-crumbs-sep">/</span>
                        <span aria-current="page">Research</span>
                    </nav>
                    <h1 className="pm-page-title">Research workspace</h1>
                    <p className="pm-page-sub">
                        Theses, Alpha Radar, watchlist, and decision journal
                    </p>
                </div>
                <div className="pm-topbar-actions">{topbarAction}</div>
            </header>

            <div className="pm-research-split">
                {/* ---------------------------- LEFT COLUMN ---------------------------- */}
                <aside className="pm-research-col pm-card">
                    <div
                        role="tablist"
                        aria-label="Research section"
                        className="pm-research-tabs"
                    >
                        {(Object.keys(TAB_LABEL) as ResearchTabKey[]).map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="tab"
                                aria-selected={tab === k}
                                className={`pm-research-tab${tab === k ? " is-active" : ""}`}
                                onClick={() => {
                                    setTab(k);
                                    setQuery("");
                                }}
                            >
                                <span className="pm-research-tab-label">{TAB_LABEL[k]}</span>
                                <span className="pm-research-tab-count">{counts[k]}</span>
                            </button>
                        ))}
                    </div>

                    <label className="pm-research-search">
                        <Search size={14} aria-hidden="true" />
                        <input
                            type="search"
                            placeholder={`Filter ${TAB_LABEL[tab].toLowerCase()}…`}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label={`Filter ${TAB_LABEL[tab].toLowerCase()}`}
                        />
                    </label>

                    <div className="pm-research-list" role="tabpanel">
                        {tab === "theses" && (
                            <ThesesColumn
                                list={activeFiltered}
                                selectedId={effectiveSelectedId}
                                onSelect={setSelectedId}
                                emptyLabel="No active theses. Click New thesis to create one."
                            />
                        )}
                        {tab === "archive" && (
                            <ThesesColumn
                                list={archivedFiltered}
                                selectedId={effectiveSelectedId}
                                onSelect={setSelectedId}
                                dimmed
                                emptyLabel="Nothing archived yet."
                            />
                        )}
                        {tab === "watchlist" && (
                            <WatchlistColumn
                                list={watchlistFiltered}
                                quotes={watchQuotes}
                            />
                        )}
                        {tab === "alphaRadar" && (
                            <AlphaRadarFilerColumn
                                data={alphaRadar}
                                query={query}
                            />
                        )}
                        {tab === "journal" && (
                            <JournalColumn
                                list={journalFiltered}
                                thesesById={thesesById}
                                onDelete={handleDeleteJournal}
                                onEdit={(e) => {
                                    setEditingJournal(e);
                                    setJournalModalOpen(true);
                                }}
                            />
                        )}
                    </div>
                </aside>

                {/* ---------------------------- RIGHT PANE ----------------------------- */}
                <section className="pm-research-pane pm-card pm-card-stack">
                    {tab === "theses" || tab === "archive" ? (
                        selectedThesis ? (
                            <ThesisDetailPane
                                thesis={selectedThesis}
                                isArchived={tab === "archive"}
                                onEdit={() => openEdit(selectedThesis)}
                                onArchive={() => handleArchive(selectedThesis)}
                                onRestore={() => handleRestore(selectedThesis)}
                                onDelete={() => handleDelete(selectedThesis)}
                            />
                        ) : (
                            <EmptyPane
                                title="Select a thesis"
                                body="Pick a thesis on the left to see its hypothesis, catalysts, and evidence breakdown."
                            />
                        )
                    ) : tab === "watchlist" ? (
                        <EmptyPane
                            title="Watchlist detail"
                            body="Select a watchlist ticker to see its entry rationale, notes, and suggested target. (Dedicated pane coming in Phase 6.)"
                        />
                    ) : tab === "alphaRadar" ? (
                        <AlphaRadarDetailPane data={alphaRadar} />
                    ) : (
                        <EmptyPane
                            title="Decision journal"
                            body="Every trade's rationale lives on the left. Select an entry to surface the linked thesis and rationale side-by-side. (Dedicated pane coming in Phase 6.)"
                        />
                    )}
                </section>
            </div>

            <NewThesisModal
                open={thesisModalOpen}
                onOpenChange={(open) => {
                    setThesisModalOpen(open);
                    if (!open) setEditingThesis(null);
                }}
                editing={editingThesis}
                onSubmit={submitThesis}
            />

            <NewJournalEntryModal
                open={journalModalOpen}
                onOpenChange={(open) => {
                    setJournalModalOpen(open);
                    if (!open) setEditingJournal(null);
                }}
                editing={editingJournal}
                theses={theses}
                onSubmit={(draft) => {
                    if (editingJournal) updateJournal(editingJournal.id, draft);
                    else createJournal(draft);
                }}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ThesesColumn({
    list,
    selectedId,
    onSelect,
    dimmed = false,
    emptyLabel,
}: {
    list: Thesis[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    dimmed?: boolean;
    emptyLabel: string;
}) {
    if (list.length === 0) {
        return <div className="pm-research-empty-hint">{emptyLabel}</div>;
    }
    return (
        <>
            {list.map((t) => (
                <ThesisListCard
                    key={t.id}
                    thesis={t}
                    selected={selectedId === t.id}
                    dimmed={dimmed}
                    onSelect={() => onSelect(t.id)}
                />
            ))}
        </>
    );
}

function WatchlistColumn({
    list,
    quotes,
}: {
    list: WatchlistItem[];
    quotes: Record<string, { price: number; change: number; changePercent: number }> | undefined;
}) {
    if (list.length === 0) {
        return <div className="pm-research-empty-hint">No watchlist matches.</div>;
    }
    return (
        <>
            {list.map((w) => {
                const live = quotes?.[w.ticker.toUpperCase()];
                const price = live && Number.isFinite(live.price) ? live.price : w.currentPrice;
                const distancePct =
                    price > 0 ? ((w.targetEntry - price) / price) * 100 : 0;
                const toneClass =
                    distancePct > 0 ? "pm-num-neg" : "pm-num-pos"; // target below current = wait, above = red
                return (
                    <article key={w.id} className="pm-watch-list-card">
                        <header className="pm-watch-list-head">
                            <div>
                                <span className="pm-watch-list-sym">{w.ticker}</span>
                                <span className="pm-watch-list-company">{w.companyName}</span>
                            </div>
                            {live && (
                                <span
                                    className="pm-live-dot"
                                    aria-label="Live quote"
                                    title="Live quote, refreshes every 60s"
                                />
                            )}
                        </header>
                        <p className="pm-watch-list-reason">{w.reason}</p>
                        <div className="pm-watch-list-prices">
                            <div>
                                <span className="pm-watch-list-k">Price</span>
                                <span className="pm-watch-list-v num">
                                    ${price.toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="pm-watch-list-k">Target entry</span>
                                <span className="pm-watch-list-v num">
                                    ${w.targetEntry.toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="pm-watch-list-k">Distance</span>
                                <span className={`pm-watch-list-v num ${toneClass}`}>
                                    {distancePct > 0 ? "+" : distancePct < 0 ? "−" : ""}
                                    {Math.abs(distancePct).toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    </article>
                );
            })}
        </>
    );
}

function JournalColumn({
    list,
    thesesById,
    onEdit,
    onDelete,
}: {
    list: JournalEntry[];
    thesesById: Map<string, Thesis>;
    onEdit: (entry: JournalEntry) => void;
    onDelete: (entry: JournalEntry) => void;
}) {
    if (list.length === 0) {
        return <div className="pm-research-empty-hint">No journal entries match.</div>;
    }
    return (
        <>
            {list.map((entry) => {
                const linked = entry.thesisId ? thesesById.get(entry.thesisId) : undefined;
                const typeLabel =
                    entry.type === "entry" ? "ENTRY" : entry.type === "exit" ? "EXIT" : "HOLD";
                const typeClass =
                    entry.type === "entry"
                        ? "pm-journal-type-entry"
                        : entry.type === "exit"
                          ? "pm-journal-type-exit"
                          : "pm-journal-type-hold";
                return (
                    <article key={entry.id} className="pm-journal-list-card">
                        <header className="pm-journal-list-head">
                            <div>
                                <span className={`pm-journal-type ${typeClass}`}>{typeLabel}</span>
                                <span className="pm-journal-sym">{entry.ticker}</span>
                                {entry.outcome !== "pending" && (
                                    <span
                                        className={`pm-journal-outcome pm-journal-outcome-${entry.outcome}`}
                                    >
                                        {entry.outcome}
                                    </span>
                                )}
                            </div>
                            <span className="pm-journal-date">
                                {new Date(entry.date).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                })}
                            </span>
                        </header>
                        <p className="pm-journal-decision">{entry.decision}</p>
                        <p className="pm-journal-rationale">{entry.rationale}</p>
                        {linked && (
                            <span className="pm-journal-linked">
                                Linked to {linked.ticker} · {linked.title}
                            </span>
                        )}
                        <footer className="pm-journal-foot">
                            <button
                                type="button"
                                className="pm-btn pm-btn-ghost pm-btn-sm"
                                onClick={() => onEdit(entry)}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className="pm-btn pm-btn-ghost pm-btn-sm pm-btn-danger"
                                onClick={() => onDelete(entry)}
                                aria-label={`Delete journal entry for ${entry.ticker}`}
                            >
                                <Trash2 size={14} aria-hidden="true" />
                            </button>
                        </footer>
                    </article>
                );
            })}
        </>
    );
}

function EmptyPane({ title, body }: { title: string; body: string }) {
    return (
        <div className="pm-research-empty">
            <h2 className="pm-card-title">{title}</h2>
            <p className="pm-card-subtitle">{body}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function matchQuery(q: string, ...fields: Array<string | undefined>): boolean {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(needle));
}

function filterTheses(list: readonly Thesis[], q: string): Thesis[] {
    if (!q.trim()) return [...list];
    return list.filter((t) =>
        matchQuery(q, t.ticker, t.companyName, t.title, t.description, ...t.tags),
    );
}

function parseInitialTab(value: string | null): ResearchTabKey {
    switch (value) {
        case "watchlist":
            return "watchlist";
        case "alpha-radar":
        case "alphaRadar":
            return "alphaRadar";
        case "journal":
            return "journal";
        case "archive":
            return "archive";
        case "theses":
        default:
            return "theses";
    }
}
