'use client';

import {
    LayoutDashboard,
    TrendingUp,
    Briefcase,
    FileText,
    Cpu,
    CircleHelp,
    PlayCircle,
    Settings,
    Sparkles,
    X,
} from 'lucide-react';
import {
    PRIMARY_NAV,
    SYSTEM_NAV,
    activeDestination,
    type NavDestinationId,
} from '@/lib/navigation';
import { BrandMark } from './BrandMark';
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
 *   │   · Today                                  │
 *   │   · Portfolio                              │
 *   │   · Performance                            │
 *   │   · Research                               │
 *   │   · Strategies                             │
 *   │   · Trade                                  │
 *   │   · Ask [Beta]                             │
 *   │                                            │
 *   │  SYSTEM                                    │
 *   │   · Settings                               │
 *   │   · Help                                   │
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
    id: NavDestinationId;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    /** Badge count, or undefined to hide. */
    badge?: number;
    /** Optional short tag shown next to the title (e.g. "Beta"). */
    pill?: string;
}

interface NavSection {
    label: string;
    items: readonly NavItem[];
}

const ICONS: Record<NavDestinationId, React.ComponentType<{ className?: string }>> = {
    today: LayoutDashboard,
    portfolio: Briefcase,
    performance: TrendingUp,
    research: FileText,
    strategies: Cpu,
    trade: PlayCircle,
    ask: Sparkles,
    settings: Settings,
    help: CircleHelp,
};

// Destinations come from `lib/navigation` — the same config drives the
// section tabs, the ⌘K palette, and the legacy-route redirects.
const NAV_SECTIONS: readonly NavSection[] = [
    {
        label: 'Workspace',
        items: PRIMARY_NAV.map((d) => ({ id: d.id, title: d.title, href: d.href, pill: d.pill, icon: ICONS[d.id] })),
    },
    {
        label: 'System',
        items: SYSTEM_NAV.map((d) => ({ id: d.id, title: d.title, href: d.href, pill: d.pill, icon: ICONS[d.id] })),
    },
];

export function AppSidebar() {
    const pathname = usePathname() ?? '/';
    const activeId = activeDestination(pathname)?.id ?? null;
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
                                    const active = item.id === activeId;
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
