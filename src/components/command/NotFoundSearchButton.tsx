'use client';

import { Search } from 'lucide-react';
import { useUiStore } from '@/lib/stores/uiStore';

export function NotFoundSearchButton() {
    const openCommand = useUiStore((s) => s.openCommand);
    return (
        <button type="button" className="pm-btn pm-btn-primary" onClick={openCommand}>
            <Search size={14} aria-hidden="true" />
            <span>Search</span>
        </button>
    );
}
