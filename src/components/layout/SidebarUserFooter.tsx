"use client";

import Link from "next/link";
import { MoreVertical, User, Settings, LogOut, Palette } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { usePortfolioCount } from "@/lib/hooks/usePortfolioCount";
import { useUiStore } from "@/lib/stores/uiStore";
import { cn } from "@/lib/utils";

/**
 * Sidebar user footer (AR-66)
 *
 *  avatar (initials) | Name + "Pro · N accounts"    | ⋯ kebab menu
 *
 * The kebab menu is a shadcn DropdownMenu (which we already use elsewhere
 * for notifications) anchored to the footer so it opens "up" when there's
 * no room below — the sidebar hits the viewport bottom.
 *
 * Why show the account count here rather than in the Topbar? The handoff
 * plants identity + plan info at the bottom of the sidebar (same place the
 * user looks to sign out); keeping it there preserves the muscle memory
 * from every product the user has used — Notion/Linear/Slack all put
 * identity in the sidebar footer.
 */

function initialsOf(fullName: string): string {
    const parts = fullName.split(" ").filter(Boolean);
    if (parts.length === 0) return "?";
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${last}`.toUpperCase() || "?";
}

export function SidebarUserFooter() {
    const fullName = useSettingsStore((s) => s.profile.fullName);
    const openTweaks = useUiStore((s) => s.openTweaks);
    const { count, isLoading, isError } = usePortfolioCount();

    // Renderable plan line. While loading we show just "Pro" so the footer
    // doesn't jump when the count arrives. On error we still show "Pro" —
    // count is nice-to-have, not critical to the user's identity.
    const planLine =
        isLoading || isError || count === null
            ? "Pro"
            : `Pro · ${count} ${count === 1 ? "account" : "accounts"}`;

    const initials = initialsOf(fullName);

    return (
        <div className="pm-user-footer">
            <div className="pm-user-avatar" aria-hidden="true">
                {initials}
            </div>
            <div className="pm-user-info">
                <p className="pm-user-name" title={fullName}>
                    {fullName}
                </p>
                <p className="pm-user-plan">{planLine}</p>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger
                    className={cn(
                        "pm-user-menu-btn",
                        // Keyboard focus outline; inlined here because this is
                        // one of only two places the pattern is used (the other
                        // is .pm-accent-dot), and a named utility would obscure
                        // the local intent.
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    )}
                    aria-label={`Account menu for ${fullName}`}
                >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium truncate">
                                {fullName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {planLine}
                            </span>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                        <Link
                            href="/settings?tab=profile"
                            className="flex items-center gap-2"
                        >
                            <User className="h-4 w-4" aria-hidden="true" />
                            <span>Profile</span>
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={(e) => {
                            // Default shadcn behavior closes the menu after the
                            // click resolves, which races the Tweaks panel open
                            // animation. Prevent default → openTweaks → menu
                            // stays open for a tick but that's acceptable.
                            e.preventDefault();
                            openTweaks();
                        }}
                    >
                        <Palette className="h-4 w-4" aria-hidden="true" />
                        <span>Appearance</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link
                            href="/settings"
                            className="flex items-center gap-2"
                        >
                            <Settings className="h-4 w-4" aria-hidden="true" />
                            <span>Settings</span>
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        // Placeholder — real sign-out lands alongside auth work.
                        // Keeping the affordance visible so the menu is complete.
                        disabled
                    >
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                        <span>Sign out</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
