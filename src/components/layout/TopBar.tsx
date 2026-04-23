'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
    Menu,
    Search,
    Settings2,
    ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/lib/stores/uiStore';
import { NotificationBell } from '@/components/layout/NotificationBell';
import {
    useCurrentPageHeader,
    usePageHeader,
} from '@/components/layout/PageHeaderContext';
import { formatEtClock } from '@/lib/markets/market-hours';
import { cn } from '@/lib/utils';

/**
 * TopBar (AR-67)
 *
 * Handoff reference: `components/TopBar.jsx` + `styles.css` `.pm-topbar*`.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ [≡] Home › Portfolios › Growth      [🔍 Search ⌘K] [🕐][⚙][🔔]   │
 *   │ Growth Portfolio                                  [+ Add holding]│
 *   │ A focused momentum sleeve                                         │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * Two visual rows, one sticky container:
 *   row 1 = breadcrumbs + search + clock + Tweaks gear + notifications
 *   row 2 = title/subtitle + right-aligned actions
 *
 * Row 2 collapses away when the page hasn't declared a header yet — so
 * un-migrated pages and loading states render cleanly without a phantom
 * blank "title area". The Topbar never crashes on a missing header.
 *
 * The title / subtitle / crumbs / actions all come from `useCurrentPageHeader()`
 * — populated by pages calling `usePageHeader(...)` on mount. This is the
 * right shape because the Topbar is mounted once in `app/layout.tsx` and
 * pages need to "push" their metadata up without remounting the chrome.
 */

// Clock ticks every 30s — the chrome Topbar doesn't need second-level
// precision, and it keeps this render off the React hot path. Shares the
// same cadence as SidebarMarketCard so both clocks stay visually in sync.
const CLOCK_TICK_MS = 30_000;

function useEtClock(): string {
    // `null` on first render so SSR and the first client paint agree.
    const [now, setNow] = useState<Date | null>(null);
    useEffect(() => {
        setNow(new Date());
        const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);
    return now ? formatEtClock(now) : '';
}

interface TopBarProps {
    /** Optional callback for the ⌘K command palette. If not wired, the
     *  search button is inert (but still keyboard-focusable). Phase 2 lands
     *  the real palette. */
    onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
    const toggleSidebar = useUiStore((s) => s.toggleSidebar);
    const toggleTweaks = useUiStore((s) => s.toggleTweaks);
    const header = useCurrentPageHeader();
    const clock = useEtClock();

    const [isMac, setIsMac] = useState(false);
    useEffect(() => {
        // `navigator.platform` is deprecated but remains the most reliable
        // way to detect macOS vs Windows for the ⌘ vs Ctrl glyph. The modern
        // `navigator.userAgentData` is still not everywhere.
        setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    }, []);

    // Global ⌘K / Ctrl+K listener. Lives here rather than in a dedicated
    // provider because the Topbar is the only consumer today; when the
    // command palette ships we can promote this to a hook.
    useEffect(() => {
        if (!onSearchClick) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                onSearchClick();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onSearchClick]);

    const hasHeader = header !== null;
    const crumbs = header?.crumbs ?? [];
    const hasCrumbs = crumbs.length > 0;

    return (
        <header className="pm-topbar" aria-label="Page chrome">
            {/* Row 1: breadcrumbs + search + utilities */}
            <div className="pm-topbar-row pm-topbar-row-top">
                <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden pm-topbar-menu"
                    onClick={toggleSidebar}
                    aria-label="Open navigation"
                >
                    <Menu className="h-5 w-5" />
                </Button>

                <nav
                    className="pm-topbar-crumbs"
                    aria-label="Breadcrumb"
                    // Always rendered even when empty so the layout row doesn't
                    // collapse — keeps the utility cluster pinned right.
                >
                    {hasCrumbs ? (
                        <ol className="pm-crumb-list">
                            {crumbs.map((crumb, idx) => {
                                const isLast = idx === crumbs.length - 1;
                                return (
                                    <li
                                        key={`${crumb}-${idx}`}
                                        className={cn(
                                            'pm-crumb-item',
                                            isLast && 'is-current'
                                        )}
                                    >
                                        <span>{crumb}</span>
                                        {!isLast && (
                                            <ChevronRight
                                                className="pm-crumb-sep"
                                                aria-hidden="true"
                                            />
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    ) : (
                        // Visual-only filler so the right cluster stays pinned
                        // while the header is loading. aria-hidden because
                        // there's nothing semantic here.
                        <span aria-hidden="true" />
                    )}
                </nav>

                <div className="pm-topbar-utils">
                    <button
                        type="button"
                        onClick={onSearchClick}
                        className="pm-topbar-search"
                        aria-label="Search or jump to"
                    >
                        <Search
                            className="pm-topbar-search-icon"
                            aria-hidden="true"
                        />
                        <span className="pm-topbar-search-text">
                            Search or jump to…
                        </span>
                        <kbd className="pm-topbar-kbd" aria-hidden="true">
                            {isMac ? '⌘K' : 'Ctrl+K'}
                        </kbd>
                    </button>

                    <span
                        className="pm-topbar-clock"
                        aria-label={clock ? `Eastern time ${clock}` : undefined}
                        // Hidden on narrow widths — the sidebar market card
                        // already shows the ET clock. Showing it twice would
                        // be noise.
                    >
                        {clock || '—'}
                    </span>

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleTweaks}
                        aria-label="Open appearance tweaks"
                        className="pm-topbar-gear"
                    >
                        <Settings2 className="h-5 w-5" aria-hidden="true" />
                    </Button>

                    <NotificationBell />
                </div>
            </div>

            {/* Row 2: title/subtitle + actions.
                Only rendered when a page has declared a header. Keeps
                un-migrated routes looking clean rather than stretched. */}
            {hasHeader && (
                <div className="pm-topbar-row pm-topbar-row-bottom">
                    <div className="pm-topbar-heading">
                        <h1 className="pm-topbar-title">{header.title}</h1>
                        {header.subtitle && (
                            <p className="pm-topbar-sub">{header.subtitle}</p>
                        )}
                    </div>
                    {header.actions && (
                        <div className="pm-topbar-actions">{header.actions}</div>
                    )}
                </div>
            )}
        </header>
    );
}

/**
 * `<PageHeaderSync>` — server-component-friendly page-header setter.
 *
 * Use this when the page is an async server component that can't call
 * `usePageHeader` directly. It's a tiny client-only shim:
 *
 *   export default async function HoldingsPage() {
 *       const data = await db.query.holdings.findMany();
 *       return (
 *           <>
 *               <PageHeaderSync
 *                   title="Holdings"
 *                   crumbs={['Workspace', 'Holdings']}
 *               />
 *               <HoldingsContent data={data} />
 *           </>
 *       );
 *   }
 *
 * For pages that are already `'use client'` (Performance, Strategies…)
 * call `usePageHeader(...)` inline — no wrapper needed.
 */
export function PageHeaderSync(props: {
    title: string;
    subtitle?: string;
    crumbs?: string[];
    actions?: ReactNode;
}): null {
    usePageHeader(props);
    return null;
}

// Re-export `<Link>` so the breadcrumb trail can become interactive in a
// follow-up (right now all crumbs are plain text — pages set them as
// strings). When we add a `href?: string` field to `PageHeader.crumbs`,
// the list item renders a `<Link>` for crumbs that have one and a span
// otherwise. Keeping the import co-located here.
void Link;
