
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { exportToCsv } from './exportCsv';

// --- Mocks ---

let createdBlobContent: string[] = [];
let createdBlobType = '';
let revokedUrl: string | null = null;
let lastCreatedElement: MockAnchorElement | null = null;

interface MockAnchorElement {
    tag: string;
    href: string;
    download: string;
    clicked: boolean;
    click: () => void;
}

class MockBlob {
    content: string[];
    options: { type: string };
    constructor(content: string[], options: { type: string }) {
        this.content = content;
        this.options = options;
        createdBlobContent = content;
        createdBlobType = options.type;
    }
}

const mockUrl = {
    createObjectURL: () => {
        return 'blob:mock-url';
    },
    revokeObjectURL: (url: string) => {
        revokedUrl = url;
    }
};

const mockDocument = {
    createElement: (tag: string) => {
        const element = {
            tag,
            href: '',
            download: '',
            click: () => {
                element.clicked = true;
            },
            clicked: false,
        };
        lastCreatedElement = element;
        return element;
    }
};

const originalBlob = globalThis.Blob;
const originalURL = globalThis.URL;
const originalDocument = globalThis.document;

globalThis.Blob = MockBlob as unknown as typeof Blob;
globalThis.URL = mockUrl as unknown as typeof URL;
globalThis.document = mockDocument as unknown as Document;

describe('exportToCsv', () => {
    after(() => {
        globalThis.Blob = originalBlob;
        globalThis.URL = originalURL;
        globalThis.document = originalDocument;
    });

    beforeEach(() => {
        createdBlobContent = [];
        createdBlobType = '';
        revokedUrl = null;
        lastCreatedElement = null;
    });

    test('should return early if rows are empty', () => {
        exportToCsv('test.csv', []);
        assert.strictEqual(lastCreatedElement, null);
    });

    test('should correctly format simple data to CSV', () => {
        const rows = [
            { name: 'John', age: 30 },
            { name: 'Jane', age: 25 }
        ];
        exportToCsv('users.csv', rows);

        const expectedCsv = 'name,age\nJohn,30\nJane,25';
        assert.strictEqual(createdBlobContent[0], expectedCsv);
        assert.strictEqual(createdBlobType, 'text/csv;charset=utf-8;');
        assert.ok(lastCreatedElement);
        assert.strictEqual(lastCreatedElement.download, 'users.csv');
        assert.strictEqual(lastCreatedElement.clicked, true);
        assert.strictEqual(revokedUrl, 'blob:mock-url');
    });

    test('should handle commas, quotes and newlines in values', () => {
        const rows = [
            { text: 'Hello, World' },
            { text: 'He said "Hello"' },
            { text: 'Line 1\nLine 2' }
        ];
        exportToCsv('escaped.csv', rows);

        // "Hello, World"
        // "He said ""Hello"""
        // "Line 1\nLine 2"
        const expectedCsv = 'text\n"Hello, World"\n"He said ""Hello"""\n"Line 1\nLine 2"';
        assert.strictEqual(createdBlobContent[0], expectedCsv);
    });

    test('should handle null and undefined values as empty strings', () => {
        const rows = [
            { name: 'John', note: null },
            { name: 'Jane', note: undefined }
        ];
        exportToCsv('nulls.csv', rows);

        const expectedCsv = 'name,note\nJohn,\nJane,';
        assert.strictEqual(createdBlobContent[0], expectedCsv);
    });

    test('should handle numeric and boolean values', () => {
        const rows = [
            { value: 123, flag: true },
            { value: 0, flag: false }
        ];
        exportToCsv('types.csv', rows);

        const expectedCsv = 'value,flag\n123,true\n0,false';
        assert.strictEqual(createdBlobContent[0], expectedCsv);
    });

    test('regression: text a spreadsheet would run as a formula is written as text (i69)', () => {
        // A note or account name the user typed or imported, or a bank sent.
        const rows = [
            { text: '=HYPERLINK("https://evil.test","Click")' },
            { text: '+cmd' },
            { text: '-1+1' },
            { text: '@SUM(A1)' },
            { text: '\t=1+1' },
            { text: '\r=1+1' },
            { text: 'x\r=1+1' },
        ];
        exportToCsv('formulas.csv', rows);

        assert.strictEqual(createdBlobContent[0], [
            'text',
            '"\'=HYPERLINK(""https://evil.test"",""Click"")"',
            "'+cmd",
            "'-1+1",
            "'@SUM(A1)",
            "'\t=1+1",
            '"\'\r=1+1"',
            // A lone carriage return is a row break to a spreadsheet: quoted.
            '"x\r=1+1"',
        ].join('\n'));
    });

    test('numbers stay numbers, negative ones and numeric text included', () => {
        exportToCsv('numbers.csv', [{ amount: -1250.5, text: '-12.50', exp: '+3', note: '- not a number' }]);

        assert.strictEqual(createdBlobContent[0], "amount,text,exp,note\n-1250.5,-12.50,+3,'- not a number");
    });
});
