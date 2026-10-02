/**
 * Atlas Wealth brand mark — a line chart with a ping dot at the end.
 * Inline SVG so it follows `currentColor` (the accent) and needs no
 * network request. Shared by the sidebar and the sign-in page.
 */
export function BrandMark({ size = 22, className = "pm-brand-svg" }: { size?: number; className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            className={className}
            aria-hidden="true"
        >
            <path
                d="M3 17 L8 12 L12 14 L16 8 L21 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="21" cy="10" r="2.5" fill="currentColor" />
        </svg>
    );
}
