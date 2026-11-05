/**
 * The figures Claude writes have to be the tools' (launch item i59). The
 * answer is kept only if every amount, percentage, decimal and grouped
 * number in it is one a tool returned, or one in the question or the
 * conversation. Whole numbers under 1,000 (a count, a year, "top 5") are
 * left alone: they're never a value Ask computes.
 *
 * A figure matches by its number, whatever surrounds it: "-$1,200" is
 * backed by "$1,200", and "41.90%" by "41.9%". Anything else, a rounding
 * ("$12.3K"), a sum or a made-up value, isn't.
 */

/** "$1,200", "CA$1,000", "41.9%", "0.85", "12,340". */
const FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\b\d+\.\d+\b|\b\d{1,3}(?:,\d{3})+\b/g;

/** Each figure in `text`, as its number: "$1,200.50" → "1200.5". */
export function figuresIn(text: string): string[] {
    return (text.match(FIGURE) ?? []).map((figure) => String(Number(figure.replace(/[^\d.]/g, ""))));
}

/** The figures in `answer` that none of `sources` has. */
export function unbackedFigures(answer: string, sources: readonly string[]): string[] {
    const backed = new Set(sources.flatMap(figuresIn));
    return figuresIn(answer).filter((figure) => !backed.has(figure));
}
