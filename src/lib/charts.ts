
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

    // Find finite values and their count
    let firstFiniteIndex = -1;
    let finiteCount = 0;
    for (let i = 0; i < data.length; i++) {
        if (Number.isFinite(data[i])) {
            if (firstFiniteIndex === -1) firstFiniteIndex = i;
            finiteCount++;
        }
    }

    // Return empty if no valid data points
    if (finiteCount === 0) return '';

    // Handle single finite point - center it vertically
    if (finiteCount === 1) {
        return `0,${height / 2}`;
    }

    let min = data[firstFiniteIndex];
    let max = data[firstFiniteIndex];
    for (let i = firstFiniteIndex + 1; i < data.length; i++) {
        const value = data[i];
        if (Number.isFinite(value)) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
    }

    const range = max - min;

    // Avoid division by zero for flat lines
    const effectiveRange = range === 0 ? 1 : range;

    const drawHeight = height - (padding * 2);

    const stepX = data.length > 1 ? width / (data.length - 1) : 0;

    // Fallback for invalid draw height
    if (drawHeight <= 0) {
        let points = '';
        for (let i = 0; i < data.length; i++) {
            if (!Number.isFinite(data[i])) continue;
            const x = i * stepX;
            if (points.length > 0) points += ' ';
            points += x.toFixed(2) + ',' + (height / 2).toFixed(2);
        }
        return points;
    }

    // Optimized: Using a loop and string concatenation is significantly faster
    // than .map().join() as it avoids intermediate array creation and extra allocations.
    let points = '';
    for (let i = 0; i < data.length; i++) {
        const value = data[i];
        if (!Number.isFinite(value)) continue;

        const x = i * stepX;
        const normalized = (value - min) / effectiveRange;
        // Invert Y axis because SVG 0 is at top
        const y = (height - padding) - (normalized * drawHeight);

        if (points.length > 0) points += ' ';
        points += x.toFixed(2) + ',' + y.toFixed(2);
    }

    return points;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Evenly spaced x-axis labels taken from the series' own months (e.g.
 * "Oct 25", "Jan 26" …) so the axis always matches the data — fixed
 * "Jan … Dec" slots mislabel any window that isn't a calendar year.
 */
export function monthAxisLabels(points: readonly { year: number; month: number }[], count = 5): string[] {
    if (points.length === 0) return [];
    const n = Math.min(count, points.length);
    if (n === 1) return [`${SHORT_MONTHS[points[0].month]} ${String(points[0].year).slice(2)}`];
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        const p = points[Math.round((i * (points.length - 1)) / (n - 1))];
        out.push(`${SHORT_MONTHS[p.month]} ${String(p.year).slice(2)}`);
    }
    return out;
}
