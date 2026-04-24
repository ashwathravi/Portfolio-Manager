'use client';

import {
    LayoutDashboard,
    TrendingUp,
    Briefcase,
    FileText,
    Cpu,
    PlayCircle,
    Settings,
    Sparkles,
    X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/lib/stores/uiStore';
import { SidebarMarketCard } from './SidebarMarketCard';
import { SidebarUserFooter } from './SidebarUserFooter';

/**
 * AppSidebar (AR-66)
 *
 * Handoff reference: `components/Sidebar.jsx` + `styles.css` `.pm-sidebar*`.
 *
 * Structure:
 *   ┌─ Brand block ─────────────────────────────┐
 *   │  [mark]  Atlas Wealth                     │
 *   │          Personal Investment OS           │
 *   ├─ Nav ──────────────────────────────────────┤
 *   │  WORKSPACE                                 │
 *   │   · Dashboard                              │
 *   │   · Performance                            │
 *   │   · Holdings                               │
 *   │   · Research                               │
 *   │   · Strategies                             │
 *   │   · Execution [badge]                      │
 *   │                                            │
 *   │  SYSTEM                                    │
 *   │   · Settings                               │
 *   ├─ Market card ──────────────────────────────┤
 *   │  ● Market open     9:42 AM ET              │
 *   │  S&P  +0.42%                               │
 *   │  NDX  +0.18%                               │
 *   │  BTC  +1.30%                               │
 *   ├─ User footer ──────────────────────────────┤
 *   │  [AR]  Ashwath Ravichandran   ⋯           │
 *   │        Pro · 3 accounts                    │
 *   └────────────────────────────────────────────┘
 *
 * The nav is deliberately flatter than the pre-Phase-1 sidebar (no more
 * expandable submenus for Portfolio/Research/Strategies). Sub-pages are
 * reached through the landing page of each section — which is closer to
 * how every other financial product ships and reduces cognitive load.
 */

interface NavItem {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    /** Badge count, or undefined to hide. Currently only Execution uses
     *  this; wire-up for a global working-orders store lands with the
     *  Execution rework (Phase 7). */
    badge?: number;
    /** Optional short tag shown next to the title — used for "Beta"
     *  on new surfaces like Ask Ledger (AR-115). */
    pill?: string;
}

interface NavSection {
    label: string;
    items: readonly NavItem[];
}

const NAV_SECTIONS: readonly NavSection[] = [
    {
        label: 'Workspace',
        items: [
            { title: 'Dashboard', icon: LayoutDashboard, href: '/' },
            { title: 'Performance', icon: TrendingUp, href: '/performance' },
            { title: 'Holdings', icon: Briefcase, href: '/portfolios/holdings' },
            { title: 'Research', icon: FileText, href: '/research' },
            { title: 'Strategies', icon: Cpu, href: '/strategies' },
            { title: 'Execution', icon: PlayCircle, href: '/execution' },
            { title: 'Ask Ledger', icon: Sparkles, href: '/ask', pill: 'Beta' },
        ],
    },
    {
        label: 'System',
        items: [{ title: 'Settings', icon: Settings, href: '/settings' }],
    },
];

/** Route-match helper.
 *
 *   `/`                matches ONLY exact `/` (dashboard home, no prefix)
 *   `/portfolios/holdings` matches `/portfolios/holdings` + deeper
 *   `/research`        matches `/research` + `/research/...`
 *
 * This keeps Holdings active on `/portfolios/holdings/AAPL` while Dashboard
 * is only active on `/` itself. */
function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
    const pathname = usePathname();
    const sidebarOpen = useUiStore((s) => s.sidebarOpen);
    const closeSidebar = useUiStore((s) => s.closeSidebar);

    // Close the mobile drawer on route change. The layout keeps the sidebar
    // always-visible on md+ screens via CSS `translate-x-0`, so this effect
    // only matters for the mobile drawer.
    useEffect(() => {
        closeSidebar();
    }, [pathname, closeSidebar]);

    return (
        <>
            {/* Mobile backdrop — covers content behind the drawer and closes
                the sidebar when tapped. Hidden on md+. */}
            {sidebarOpen && (
                <button
                    type="button"
                    aria-label="Close navigation"
                    onClick={closeSidebar}
                    className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm md:hidden"
                />
            )}
            <aside
                className={cn(
                    'pm-sidebar',
                    sidebarOpen ? 'is-open' : undefined
                )}
                aria-label="Primary navigation"
            >
                {/* Brand block */}
                <div className="pm-sidebar-brand">
                    <div className="pm-sidebar-mark" aria-hidden="true">
                        <BrandMark />
                    </div>
                    <div className="pm-sidebar-wordmark">
                        <p className="pm-sidebar-title">Atlas Wealth</p>
                        <p className="pm-sidebar-sub">
                            Personal Investment OS
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close navigation"
                        className="pm-sidebar-close md:hidden"
                        onClick={closeSidebar}
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Nav */}
                <nav className="pm-sidebar-nav" aria-label="Main navigation">
                    {NAV_SECTIONS.map((section) => (
                        <div key={section.label} className="pm-nav-section">
                            <p
                                className="pm-nav-label"
                                // Uppercase-styled section label; using a span
                                // role="heading" aria-level="3" hurts more than
                                // it helps since each section's items are
                                // already in a <ul> — screen readers announce
                                // the label as list context. Leave it as <p>.
                            >
                                {section.label}
                            </p>
                            <ul className="pm-nav-list">
                                {section.items.map((item) => {
                                    const active = isActive(item.href, pathname);
                                    const Icon = item.icon;
                                    return (
                                        <li key={item.href}>
                                            <Link
                                                href={item.href}
                                                aria-current={active ? 'page' : undefined}
                                                className={cn(
                                                    'pm-nav-item',
                                                    active && 'is-active'
                                                )}
                                            >
                                                <Icon
                                                    className="pm-nav-icon"
                                                    aria-hidden="true"
                                                />
                                                <span className="pm-nav-title">
                                                    {item.title}
                                                </span>
                                                {item.pill && (
                                                    <span
                                                        className="pm-nav-pill"
                                                        aria-label={`${item.pill} feature`}
                                                    >
                                                        {item.pill}
                                                    </span>
                                                )}
                                                {item.badge !== undefined &&
                                                    item.badge > 0 && (
                                                        <span
                                                            className="pm-nav-badge"
                                                            aria-label={`${item.badge} pending`}
                                                        >
                                                            {item.badge > 99
                                                                ? '99+'
                                                                : item.badge}
                                                        </span>
                                                    )}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </nav>

                {/* Market card */}
                <SidebarMarketCard />

                {/* User footer */}
                <SidebarUserFooter />
            </aside>
        </>
    );
}

/**
 * Tiny SVG brand mark — a line chart with a ping dot at the end. Keeping
 * it inline (rather than an `/public/brand.svg`) avoids an extra network
 * request on first paint and lets the colors follow `--pm-accent` via
 * `currentColor`.
 */
function BrandMark() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            className="pm-brand-svg"
        >
            <path
                d="M3 17 L8 12 L12 14 L16 8 L21 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="21" cy="10" r="2.5" fill="currentColor" />
        </svg>
    );
}
