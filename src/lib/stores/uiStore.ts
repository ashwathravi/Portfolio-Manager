import { create } from 'zustand';

interface UiState {
    // Mobile-only: whether the sidebar drawer is open. On md+ screens the
    // sidebar is always visible and this flag is ignored by the layout.
    sidebarOpen: boolean;
    openSidebar: () => void;
    closeSidebar: () => void;
    toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    sidebarOpen: false,
    openSidebar: () => set({ sidebarOpen: true }),
    closeSidebar: () => set({ sidebarOpen: false }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
