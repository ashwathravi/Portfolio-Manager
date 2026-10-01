import { create } from 'zustand';

interface UiState {
    // Mobile-only: whether the sidebar drawer is open. On md+ screens the
    // sidebar is always visible and this flag is ignored by the layout.
    sidebarOpen: boolean;
    openSidebar: () => void;
    closeSidebar: () => void;
    toggleSidebar: () => void;

    // AR-68 Tweaks panel: fast-access appearance switching (accent/theme/
    // density) shown as a floating popover anchored to the Topbar gear
    // button. Isolated from `sidebarOpen` so opening one never closes the
    // other — they're independent surfaces that can coexist.
    tweaksOpen: boolean;
    openTweaks: () => void;
    closeTweaks: () => void;
    toggleTweaks: () => void;

    // ⌘K command center: the search palette, or Ask Ledger seeded with a
    // question handed over from the palette.
    commandOpen: boolean;
    commandMode: 'search' | 'ask';
    askSeed: string | null;
    openCommand: () => void;
    openAsk: (question?: string) => void;
    closeCommand: () => void;
    toggleCommand: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    sidebarOpen: false,
    openSidebar: () => set({ sidebarOpen: true }),
    closeSidebar: () => set({ sidebarOpen: false }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

    tweaksOpen: false,
    openTweaks: () => set({ tweaksOpen: true }),
    closeTweaks: () => set({ tweaksOpen: false }),
    toggleTweaks: () => set((s) => ({ tweaksOpen: !s.tweaksOpen })),

    commandOpen: false,
    commandMode: 'search',
    askSeed: null,
    openCommand: () => set({ commandOpen: true, commandMode: 'search', askSeed: null }),
    openAsk: (question) => set({ commandOpen: true, commandMode: 'ask', askSeed: question?.trim() || null }),
    closeCommand: () => set({ commandOpen: false, askSeed: null }),
    toggleCommand: () => set((s) => (s.commandOpen ? { commandOpen: false, askSeed: null } : { commandOpen: true, commandMode: 'search', askSeed: null })),
}));
