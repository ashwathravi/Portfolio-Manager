# Palette's Journal

## 2026-02-13 - [Initial Entry]

**Learning:** Adding `aria-label` to buttons with children (like badges) overrides the children's content for screen readers. This means the badge count (e.g., "3") would be lost.
**Action:** For complex buttons with content, use hidden text (e.g., `<span className="sr-only">Notifications</span>`) alongside the visible content, rather than `aria-label`. This ensures all parts of the button are read.

## 2026-02-13 - [Semantic View Switchers]

**Learning:** Custom "button groups" used for switching views (e.g., Account vs Theme) often lack accessibility semantics like `aria-selected` or keyboard navigation.
**Action:** Replace these with the `Tabs` component (acting as a segmented control) to provide proper ARIA roles (`tablist`, `tab`, `tabpanel`) and arrow key navigation out of the box, while maintaining the same visual design via styling.

## 2026-02-13 - [Input Focus Styling]

**Learning:** Overriding default input focus styles (e.g., `focus-visible:ring-0`) removes accessibility.
**Action:** Always provide an alternative focus indicator, such as `focus-within:ring-2` on the parent container, to maintain keyboard accessibility.
