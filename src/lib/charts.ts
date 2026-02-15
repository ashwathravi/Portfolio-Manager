
/**
 * Calculates the points for an SVG polyline sparkline.
 *
 * @param data Array of numbers to plot
 * @param width Width of the SVG
 * @param height Height of the SVG
 * @returns A string of "x,y" coordinates joined by spaces
 */
export function calculateSparklinePoints(data: number[], width: number = 80, height: number = 30): string {
    if (!data || data.length === 0) return '';

    // Handle single point - center it vertically
    if (data.length === 1) {
        return `0,${height / 2}`;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;

    // Avoid division by zero for flat lines
    const effectiveRange = range === 0 ? 1 : range;

    const padding = 5;
    const drawHeight = height - (padding * 2);

    // Ensure we have positive draw height
    if (drawHeight <= 0) {
        return data.map((_, i) => {
            const x = (i / (data.length - 1)) * width;
            return `${x},${height / 2}`;
        }).join(' ');
    }

    return data.map((value, i) => {
        const x = (i / (data.length - 1)) * width;
        const normalized = (value - min) / effectiveRange;
        // Invert Y axis because SVG 0 is at top
        // value = min -> normalized = 0 -> y = height - padding (bottom)
        // value = max -> normalized = 1 -> y = padding (top)
        const y = (height - padding) - (normalized * drawHeight);

        // Round to 2 decimal places to reduce string size
        return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`;
    }).join(' ');
}
