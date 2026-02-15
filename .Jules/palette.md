# Palette's Journal

## 2026-02-13 - [Initial Entry]
**Learning:** Adding `aria-label` to buttons with children (like badges) overrides the children's content for screen readers. This means the badge count (e.g., "3") would be lost.
**Action:** For complex buttons with content, use hidden text (e.g., `<span className="sr-only">Notifications</span>`) alongside the visible content, rather than `aria-label`. This ensures all parts of the button are read.

## 2026-02-13 - Accessible Trend Indicators
**Learning:** Purely visual trend indicators (color + icon) are insufficient for screen readers. Using just "+5%" or "-5%" with color/icon doesn't convey direction clearly to non-sighted users.
**Action:** Always pair trend percentages with visually hidden text (e.g., `<span className="sr-only">Up by</span>`) and ensure icons are marked `aria-hidden="true"`.
