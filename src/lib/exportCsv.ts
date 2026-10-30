// A cell a spreadsheet would read as a formula (OWASP "CSV injection"). Text
// the user typed or imported, or a bank sent, can start this way.
const FORMULA_START = /^[=+\-@\t\r]/;
// Plain numbers, signed or not, are data, not formulas: "-12.50" stays a number.
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** One cell: formula-like text gets a leading apostrophe, so it stays text. */
function csvCell(value: unknown): string {
    let str = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && FORMULA_START.test(str) && !PLAIN_NUMBER.test(str)) {
        str = `'${str}`;
    }
    // Quoted when it holds a comma, quote or line break (a lone \r included).
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Converts an array of objects to a CSV string and triggers a browser download.
 */
export function exportToCsv(filename: string, rows: Record<string, unknown>[]): void {
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
            headers.map((h) => csvCell(row[h])).join(',')
        ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
