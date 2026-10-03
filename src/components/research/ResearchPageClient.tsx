"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuotesQuery } from "@/lib/api/market-data/queries";
import { useThesisStore } from "@/lib/research/useThesisStore";
import { useJournalStore } from "@/lib/research/useJournalStore";
import type { Thesis, ThesisDraft } from "@/lib/research/thesis";
import type { JournalEntry } from "@/lib/research/journal";
import { useWatchlist } from "@/lib/research/useWatchlist";
import { distanceToEntryPct, type WatchItem } from "@/lib/research/watchlist";
import { SampleTag } from "@/components/data-display/SampleTag";
import { WatchlistDetailPane } from "./WatchlistDetailPane";
import { JournalDetailPane } from "./JournalDetailPane";
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
    const watchlist = useWatchlist();
    const [selectedWatch, setSelectedWatch] = useState<string | null>(null);
    const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);

    const thesesById = useMemo(
        () => new Map(theses.map((t) => [t.id, t] as const)),
        [theses],
    );

    // Live watchlist quotes — same behavior the old WatchlistSection had.
    const watchSymbols = useMemo(
        () => watchlist.items.map((w) => w.ticker),
        [watchlist.items],
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
            watchlist.items.filter((w) => matchQuery(query, w.ticker, w.companyName, w.reason, w.notes)),
        [watchlist.items, query],
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
        watchlist: watchlist.items.length,
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

    const selectedWatchItem =
        watchlistFiltered.find((w) => w.ticker === selectedWatch) ?? watchlistFiltered[0] ?? null;
    const selectedJournal =
        journalFiltered.find((e) => e.id === selectedJournalId) ?? journalFiltered[0] ?? null;
    const thesisForTicker = (ticker: string) =>
        active.find((t) => t.ticker === ticker) ?? archived.find((t) => t.ticker === ticker);

    // ---- Handlers -----------------------------------------------------------
    const handleAddWatch = (input: string): string | null => {
        const { item, error } = watchlist.add(input);
        if (error === "invalid") return "Enter a ticker like NVDA, BRK.B, or BTC-USD.";
        if (error === "duplicate") return `${input.trim().toUpperCase()} is already on your watchlist.`;
        if (item) {
            setSelectedWatch(item.ticker);
            setQuery("");
            toast.success(`${item.ticker} added to your watchlist.`);
        }
        return null;
    };
    const handleRemoveWatch = (item: WatchItem) => {
        watchlist.remove(item.ticker);
        if (selectedWatch === item.ticker) setSelectedWatch(null);
        toast(`${item.ticker} removed from your watchlist.`);
    };
    const openCreate = useCallback(() => {
        setEditingThesis(null);
        setThesisModalOpen(true);
    }, []);
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
    const openCreateJournal = useCallback(() => {
        setEditingJournal(null);
        setJournalModalOpen(true);
    }, []);
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
    // Memoized: it feeds the shared page header, and a fresh node on every
    // render would re-set the header (and re-render this consumer) forever.
    const topbarAction = useMemo(() =>
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
        ), [tab, openCreate, openCreateJournal]);

    usePageHeader({
        title: "Research",
        subtitle: "Theses, watchlist, Alpha Radar, and decision journal",
        crumbs: ["Research", TAB_LABEL[tab]],
        actions: topbarAction ?? undefined,
    });

    return (
        <div className="pm-research-stack">

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
                                selectedTicker={selectedWatchItem?.ticker ?? null}
                                onSelect={setSelectedWatch}
                                onAdd={handleAddWatch}
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
                                selectedId={selectedJournal?.id ?? null}
                                onSelect={setSelectedJournalId}
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
                        selectedWatchItem ? (
                            <WatchlistDetailPane
                                key={selectedWatchItem.id}
                                item={selectedWatchItem}
                                livePrice={liveWatchPrice(watchQuotes, selectedWatchItem.ticker)}
                                thesis={thesisForTicker(selectedWatchItem.ticker)}
                                onUpdate={(patch) => watchlist.update(selectedWatchItem.id, patch)}
                                onRemove={() => handleRemoveWatch(selectedWatchItem)}
                            />
                        ) : (
                            <EmptyPane
                                title={watchlist.items.length === 0 ? "Your watchlist is empty" : "No watchlist matches"}
                                body="Add a ticker on the left to track why you want it and the price you would enter at."
                            />
                        )
                    ) : tab === "alphaRadar" ? (
                        <AlphaRadarDetailPane data={alphaRadar} />
                    ) : selectedJournal ? (
                        <JournalDetailPane
                            entry={selectedJournal}
                            thesis={selectedJournal.thesisId ? thesesById.get(selectedJournal.thesisId) : undefined}
                            onEdit={() => {
                                setEditingJournal(selectedJournal);
                                setJournalModalOpen(true);
                            }}
                        />
                    ) : (
                        <EmptyPane
                            title="Decision journal"
                            body="Record why you bought, sold, or held. Use New entry to write the first one."
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

type QuoteMap = Record<string, { price: number; change: number; changePercent: number }> | undefined;

function liveWatchPrice(quotes: QuoteMap, ticker: string): number | null {
    const live = quotes?.[ticker.toUpperCase()];
    return live && Number.isFinite(live.price) && live.price > 0 ? live.price : null;
}

function WatchlistColumn({
    list,
    quotes,
    selectedTicker,
    onSelect,
    onAdd,
}: {
    list: WatchItem[];
    quotes: QuoteMap;
    selectedTicker: string | null;
    onSelect: (ticker: string) => void;
    /** Returns an error message, or null when the ticker was added. */
    onAdd: (input: string) => string | null;
}) {
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    return (
        <>
            <form
                className="pm-watch-add"
                onSubmit={(e) => {
                    e.preventDefault();
                    const message = onAdd(draft);
                    setError(message);
                    if (!message) setDraft("");
                }}
            >
                <input
                    className="pm-exec-input"
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value.toUpperCase());
                        setError(null);
                    }}
                    placeholder="Add ticker"
                    aria-label="Add ticker to watchlist"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "watch-add-error" : undefined}
                    maxLength={10}
                />
                <button type="submit" className="pm-btn pm-btn-ghost" disabled={!draft.trim()}>
                    <Plus size={14} aria-hidden="true" />
                    <span>Add</span>
                </button>
            </form>
            {error && (
                <p id="watch-add-error" className="pm-watch-add-error" role="alert">
                    {error}
                </p>
            )}
            {list.length === 0 ? (
                <div className="pm-research-empty-hint">No watchlist matches.</div>
            ) : (
                list.map((w) => {
                    const price = liveWatchPrice(quotes, w.ticker);
                    const distance = distanceToEntryPct(price, w.targetEntry);
                    return (
                        <button
                            key={w.id}
                            type="button"
                            className={`pm-watch-list-card pm-list-select${selectedTicker === w.ticker ? " is-selected" : ""}`}
                            aria-pressed={selectedTicker === w.ticker}
                            onClick={() => onSelect(w.ticker)}
                        >
                            <span className="pm-watch-list-head">
                                <span>
                                    <span className="pm-watch-list-sym">{w.ticker}</span>
                                    {w.companyName && <span className="pm-watch-list-company">{w.companyName}</span>}
                                </span>
                                {w.sample ? (
                                    <SampleTag />
                                ) : price != null ? (
                                    <span className="pm-live-dot" aria-label="Live quote" title="Live quote, refreshes every 60s" />
                                ) : null}
                            </span>
                            {w.reason && <span className="pm-watch-list-reason">{w.reason}</span>}
                            <span className="pm-watch-list-prices">
                                <span>
                                    <span className="pm-watch-list-k">Price</span>
                                    <span className="pm-watch-list-v num">{price != null ? `$${price.toFixed(2)}` : "—"}</span>
                                </span>
                                <span>
                                    <span className="pm-watch-list-k">Target entry</span>
                                    <span className="pm-watch-list-v num">
                                        {w.targetEntry != null ? `$${w.targetEntry.toFixed(2)}` : "—"}
                                    </span>
                                </span>
                                <span>
                                    <span className="pm-watch-list-k">To entry</span>
                                    <span className="pm-watch-list-v num">
                                        {distance != null
                                            ? `${distance > 0 ? "+" : distance < 0 ? "−" : ""}${Math.abs(distance).toFixed(1)}%`
                                            : "—"}
                                    </span>
                                </span>
                            </span>
                        </button>
                    );
                })
            )}
        </>
    );
}

function JournalColumn({
    list,
    thesesById,
    selectedId,
    onSelect,
    onEdit,
    onDelete,
}: {
    list: JournalEntry[];
    thesesById: Map<string, Thesis>;
    selectedId: string | null;
    onSelect: (id: string) => void;
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
                    <article
                        key={entry.id}
                        className={`pm-journal-list-card${selectedId === entry.id ? " is-selected" : ""}`}
                    >
                        <button
                            type="button"
                            className="pm-list-select"
                            aria-pressed={selectedId === entry.id}
                            onClick={() => onSelect(entry.id)}
                        >
                        <span className="pm-journal-list-head">
                            <span>
                                <span className={`pm-journal-type ${typeClass}`}>{typeLabel}</span>
                                <span className="pm-journal-sym">{entry.ticker}</span>
                                {entry.outcome !== "pending" && (
                                    <span
                                        className={`pm-journal-outcome pm-journal-outcome-${entry.outcome}`}
                                    >
                                        {entry.outcome}
                                    </span>
                                )}
                            </span>
                            <span className="pm-journal-date">
                                {new Date(entry.date).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    timeZone: "UTC",
                                })}
                            </span>
                        </span>
                        <span className="pm-journal-decision">{entry.decision}</span>
                        <span className="pm-journal-rationale">{entry.rationale}</span>
                        {linked && (
                            <span className="pm-journal-linked">
                                Linked to {linked.ticker} · {linked.title}
                            </span>
                        )}
                        </button>
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
