
/**
 * Calculates the points for an SVG polyline sparkline.
 *
 * @param data Array of numbers to plot
 * @param width Width of the SVG
 * @param height Height of the SVG
 * @param padding Padding from top/bottom (default: 5)
 * @returns A string of "x,y" coordinates joined by spaces
 */
export function calculateSparklinePoints(data: number[], width: number = 80, height: number = 30, padding: number = 5): string {
    if (!data || data.length === 0) return '';

    // Handle single point - center it vertically
    if (data.length === 1) {
        return `0,${height / 2}`;
    }

    let min = data[0];
    let max = data[0];
    for (let i = 1; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }

    const range = max - min;

    // Avoid division by zero for flat lines
    const effectiveRange = range === 0 ? 1 : range;

    const drawHeight = height - (padding * 2);

    // Ensure we have positive draw height
    if (drawHeight <= 0) {
        const stepX = width / (data.length - 1);
        return data.map((_, i) => {
            const x = i * stepX;
            return `${x.toFixed(2)},${(height / 2).toFixed(2)}`;
        }).join(' ');
    }

    const stepX = width / (data.length - 1);

    // Optimized: Using a loop and string concatenation is significantly faster
    // than .map().join() as it avoids intermediate array creation and extra allocations.
    // This improves performance when rendering many sparklines (e.g., in tables).
    let points = '';
    for (let i = 0; i < data.length; i++) {
        const value = data[i];
        const x = i * stepX;
        const normalized = (value - min) / effectiveRange;
        // Invert Y axis because SVG 0 is at top
        const y = (height - padding) - (normalized * drawHeight);

        if (i > 0) points += ' ';
        points += x.toFixed(2) + ',' + y.toFixed(2);
    }

    return points;
}
