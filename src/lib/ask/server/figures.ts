/**
 * The figures Claude writes have to be the tools' (launch item i59). The
 * answer is kept only if every amount, percentage, decimal, grouped or
 * scaled number in it is one a tool returned, or one in the question or the
 * conversation. Whole numbers under 1,000 with nothing around them (a
 * count, a year, "top 5") are left alone: they're never a value Ask
 * computes.
 *
 * A figure matches by its value, whatever surrounds it: "-$1,200" is
 * backed by "$1,200", "41.90%" by "41.9%", and "$1.8K" by "$1,800". A
 * scale word counts: "$500K" or "$500 million" isn't backed by "$500".
 * Anything else, a rounding ("$12.3K" for $12,340), a sum or a made-up
 * value, isn't backed either.
 */

/** A number, its thousands grouped or not: "12,340", "0.85", "2026". */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const SCALE_WORD = String.raw`thousand|million|billion|trillion|bn|mn|[kmbt]`;
/** An optional "$", the number, then a "%" or a scale word ("$500K", "1.2 million"). */
const FIGURE = new RegExp(String.raw`(\$\s?)?(${NUMBER})(\s?%|\s?(?:${SCALE_WORD})\b)?`, "gi");

const SCALES: Record<string, number> = {
    k: 1e3, thousand: 1e3,
    m: 1e6, mn: 1e6, million: 1e6,
    b: 1e9, bn: 1e9, billion: 1e9,
    t: 1e12, trillion: 1e12,
};

/** Each figure in `text`, as its value: "$1,200.50" → "1200.5", "$1.8K" → "1800", "41.9%" → "41.9". */
export function figuresIn(text: string): string[] {
    const figures: string[] = [];
    for (const [, dollar, digits, tail] of text.matchAll(FIGURE)) {
        const suffix = tail?.trim().toLowerCase();
        const percent = suffix === "%";
        const scale = suffix && !percent ? SCALES[suffix] : 1;
        if (!dollar && !percent && scale === 1 && !/[.,]/.test(digits)) continue;
        // Rounded to six places, so 1.1 thousand is 1100 and not 1100.0000000000002.
        figures.push(String(Number((Number(digits.replace(/,/g, "")) * scale).toFixed(6))));
    }
    return figures;
}

/** The figures in `answer` that none of `sources` has. */
export function unbackedFigures(answer: string, sources: readonly string[]): string[] {
    const backed = new Set(sources.flatMap(figuresIn));
    return figuresIn(answer).filter((figure) => !backed.has(figure));
}
