# Palette's Journal

## 2026-02-13 - [Initial Entry]
**Learning:** Adding `aria-label` to buttons with children (like badges) overrides the children's content for screen readers. This means the badge count (e.g., "3") would be lost.
**Action:** For complex buttons with content, use hidden text (e.g., `<span className="sr-only">Notifications</span>`) alongside the visible content, rather than `aria-label`. This ensures all parts of the button are read.
