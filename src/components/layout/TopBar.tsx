'use client';

import { Search, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';


interface TopBarProps {
    onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
    return (
        <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
                <div className="flex-1 max-w-2xl">
                    <Button
                        variant="outline"
                        className="w-full max-w-md justify-start text-muted-foreground border-border hover:border-primary/50 transition-colors"
                        onClick={onSearchClick}
                    >
                        <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Search or jump to...</span>
                        <span className="sm:hidden">Search...</span>
                        <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                            <span className="text-xs">⌘</span>K
                        </kbd>
                    </Button>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="relative hover:bg-accent"
                    >
                        <span className="sr-only">Notifications</span>
                        <Bell className="h-5 w-5" aria-hidden="true" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
