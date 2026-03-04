/**
 * Converts an array of objects to a CSV string and triggers a browser download.
 */
export function exportToCsv(filename: string, rows: Record<string, unknown>[]): void {
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
            headers
                .map((h) => {
                    const val = row[h];
                    const str = val === null || val === undefined ? '' : String(val);
                    // Wrap in quotes if the value contains a comma, quote, or newline
                    return str.includes(',') || str.includes('"') || str.includes('\n')
                        ? `"${str.replace(/"/g, '""')}"`
                        : str;
                })
                .join(',')
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
