# Palette's Journal

## 2026-02-13 - [Initial Entry]

**Learning:** Adding `aria-label` to buttons with children (like badges) overrides the children's content for screen readers. This means the badge count (e.g., "3") would be lost.
**Action:** For complex buttons with content, use hidden text (e.g., `<span className="sr-only">Notifications</span>`) alongside the visible content, rather than `aria-label`. This ensures all parts of the button are read.

## 2026-02-13 - Accessible Trend Indicators

**Learning:** Purely visual trend indicators (color + icon) are insufficient for screen readers. Using just "+5%" or "-5%" with color/icon doesn't convey direction clearly to non-sighted users.
**Action:** Always pair trend percentages with visually hidden text (e.g., `<span className="sr-only">Up by</span>`) and ensure icons are marked `aria-hidden="true"`.

## 2026-02-13 - [Semantic View Switchers]

**Learning:** Custom "button groups" used for switching views (e.g., Account vs Theme) often lack accessibility semantics like `aria-selected` or keyboard navigation.
**Action:** Replace these with the `Tabs` component (acting as a segmented control) to provide proper ARIA roles (`tablist`, `tab`, `tabpanel`) and arrow key navigation out of the box, while maintaining the same visual design via styling.

## 2026-02-13 - [Input Focus Styling]

**Learning:** Overriding default input focus styles (e.g., `focus-visible:ring-0`) removes accessibility.
**Action:** Always provide an alternative focus indicator, such as `focus-within:ring-2` on the parent container, to maintain keyboard accessibility.

## 2026-02-13 - [Semantic Navigation]

**Learning:** Using `div` with `onClick` for expandable navigation menus is a common accessibility anti-pattern. It breaks keyboard navigation (Enter/Space) and screen reader support (no role/state).
**Action:** Always replace interactive `div`s with semantic `<button type="button">` elements. Add `aria-expanded` and `aria-controls` to properly communicate the state and relationship to the controlled submenu.

## 2026-02-13 - [Semantic Lists for Feeds]
**Learning:** Using `div`s for activity feeds or lists deprives screen reader users of list context (e.g., "Item 1 of 5").
**Action:** Always use `<ul>` and `<li>` for lists of items, even if they look like cards or complex rows.

## 2026-02-13 - [Explicit Financial Signs]
**Learning:** Relying on color (green/red) to indicate positive/negative values fails for colorblind users and sometimes screen readers.
**Action:** Always prefix financial changes with explicit `+` or `-` signs. Use `sr-only` text to add context like "Inflow of" or "Outflow of" if the sign isn't sufficient or if the context is ambiguous.
