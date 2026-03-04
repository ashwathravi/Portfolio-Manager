'use client';

import {
    LayoutDashboard,
    TrendingUp,
    FileText,
    BookOpen,
    Cpu,
    BarChart3,
    PlayCircle,
    Settings,
    ChevronRight,
    Calendar,
    Eye,
    Archive,
    Rocket,
    Briefcase,
    FolderOpen,
    List,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/stores/settingsStore';

interface NavItem {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    badge?: string;
    children?: NavItem[];
}

const navigationItems: NavItem[] = [
    {
        title: 'Dashboard',
        icon: LayoutDashboard,
        href: '/',
    },
    {
        title: 'Performance',
        icon: TrendingUp,
        href: '/performance',
    },
    {
        title: 'Trade Analytics',
        icon: Calendar,
        href: '/analytics',
    },
    {
        title: 'Portfolio',
        icon: Briefcase,
        href: '/portfolios',
        children: [
            {
                title: 'Overview',
                icon: Briefcase,
                href: '/portfolios',
            },
            {
                title: 'Current Holdings',
                icon: FolderOpen,
                href: '/portfolios/holdings',
            },
            {
                title: 'Trade Log',
                icon: List,
                href: '/portfolios/trade-log',
            },
        ],
    },
    {
        title: 'Research',
        icon: FileText,
        href: '/research',
        children: [
            {
                title: 'Theses',
                icon: FileText,
                href: '/research?tab=theses',
            },
            {
                title: 'Watchlists',
                icon: Eye,
                href: '/research?tab=watchlist',
            },
            {
                title: 'Journal',
                icon: BookOpen,
                href: '/research?tab=journal',
            },
            {
                title: 'Archive',
                icon: Archive,
                href: '/research?tab=archive',
            },
        ],
    },
    {
        title: 'Strategies',
        icon: Cpu,
        href: '/strategies',
        children: [
            {
                title: 'Builder',
                icon: BarChart3,
                href: '/strategies/builder',
            },
            {
                title: 'Backtests',
                icon: PlayCircle,
                href: '/strategies',
            },
            {
                title: 'Deploy',
                icon: Rocket,
                href: '/strategies/deploy',
            },
        ],
    },
    {
        title: 'Settings',
        icon: Settings,
        href: '/settings',
    },
];

export function AppSidebar() {
    const pathname = usePathname();
    const [expandedItems, setExpandedItems] = useState<string[]>([]);
    const fullName = useSettingsStore((s) => s.profile.fullName);
    const initials = fullName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');

    // Auto-expand based on active route
    useEffect(() => {
        navigationItems.forEach((item) => {
            if (item.children && item.children.some((child) => pathname.startsWith(child.href))) {
                setExpandedItems((prev) =>
                    prev.includes(item.title) ? prev : [...prev, item.title]
                );
            }
        });
    }, [pathname]);

    const toggleExpanded = (title: string) => {
        setExpandedItems((prev) =>
            prev.includes(title)
                ? prev.filter((item) => item !== title)
                : [...prev, title]
        );
    };

    const renderNavItem = (item: NavItem) => {
        // Check if active or if any child is active
        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        const isExpanded = expandedItems.includes(item.title);
        const hasChildren = item.children && item.children.length > 0;
        const submenuId = hasChildren ? `submenu-${item.title.toLowerCase().replace(/\s+/g, '-')}` : undefined;

        return (
            <li key={item.title}>
                {hasChildren ? (
                    <button
                        type="button"
                        className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer',
                            'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                        onClick={() => toggleExpanded(item.title)}
                        aria-expanded={isExpanded}
                        aria-controls={submenuId}
                    >
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1 text-left select-none">{item.title}</span>
                        {item.badge && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                {item.badge}
                            </span>
                        )}
                        <ChevronRight
                            className={cn(
                                'h-4 w-4 transition-transform',
                                isExpanded && 'rotate-90'
                            )}
                        />
                    </button>
                ) : (
                    <Link
                        href={item.href}
                        aria-current={pathname === item.href ? 'page' : undefined}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                            isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                    >
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1 text-left">{item.title}</span>
                        {item.badge && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                {item.badge}
                            </span>
                        )}
                    </Link>
                )}

                {hasChildren && isExpanded && (
                    <ul
                        id={submenuId}
                        className="ml-4 mt-1 space-y-1 border-l border-border pl-2"
                    >
                        {item.children?.map((child) => (
                            <li key={child.title}>
                                <Link
                                    href={child.href}
                                    aria-current={pathname === child.href ? 'page' : undefined}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                                        pathname === child.href
                                            ? 'bg-primary/10 text-primary font-medium'
                                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                    )}
                                >
                                    <child.icon className="h-4 w-4" />
                                    <span>{child.title}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <div className="flex h-screen w-64 flex-col border-r border-border bg-card/50 backdrop-blur-xl fixed left-0 top-0 z-40">
            <div className="border-b border-border p-6">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-green-800 shadow-lg shadow-primary/20">
                        <TrendingUp className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Atlas Wealth</h2>
                        <p className="text-xs text-muted-foreground">Investment OS</p>
                    </div>
                </div>
            </div>
            <nav className="flex-1 overflow-y-auto p-4" aria-label="Main navigation">
                <ul className="space-y-2">
                    {navigationItems.map(renderNavItem)}
                </ul>
            </nav>
            <div className="border-t border-border p-4">
                <div className="flex items-center gap-3 rounded-xl bg-primary/10 p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {initials}
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-bold">{fullName}</p>
                        <p className="text-xs text-muted-foreground">Pro Plan</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
