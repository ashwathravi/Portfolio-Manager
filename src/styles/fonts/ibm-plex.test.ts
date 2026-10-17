import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ibm-plex.ts can only run inside Next's compiler (next/font reads the call
// arguments at build time), so these tests read its source.
const fontsDir = __dirname;
const srcDir = join(__dirname, '..', '..');
const source = readFileSync(join(fontsDir, 'ibm-plex.ts'), 'utf8');
const css = readFileSync(join(fontsDir, 'ibm-plex.css'), 'utf8');

interface FontCall {
    name: string;
    files: { path: string; weight: string }[];
    family: string;
    unicodeRange: string;
    preload: boolean;
}

const calls: FontCall[] = [...source.matchAll(/export const (\w+) = localFont\(\{([\s\S]*?)\n\}\);/g)].map(
    ([, name, body]) => ({
        name,
        files: [...body.matchAll(/\{ path: "([^"]+)", weight: "(\d+)" \}/g)].map(([, path, weight]) => ({ path, weight })),
        family: /prop: "font-family", value: "'([^']+)'"/.exec(body)?.[1] ?? '',
        unicodeRange: /prop: "unicode-range", value: "([^"]+)"/.exec(body)?.[1] ?? '',
        preload: !/\bpreload: false\b/.test(body),
    }),
);

/** `./ibm-plex-mono/500-latin-ext.woff2` → `latin-ext` */
const subsetOf = (path: string) => /([a-z-]+)\.woff2$/.exec(path.replace(/\/\d+-/, '/'))![1];

// Google's order: where unicode-ranges overlap, the last rule wins.
const GOOGLE_SUBSET_ORDER = ['cyrillic-ext', 'cyrillic', 'greek', 'vietnamese', 'latin-ext', 'latin'];
const FAMILIES = [
    { family: 'IBM Plex Sans', folder: 'ibm-plex-sans', weights: ['400', '500', '600', '700'], subsets: GOOGLE_SUBSET_ORDER },
    // Google has no Greek subset for Plex Mono.
    { family: 'IBM Plex Mono', folder: 'ibm-plex-mono', weights: ['400', '500', '600'], subsets: GOOGLE_SUBSET_ORDER.filter((s) => s !== 'greek') },
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

describe('self-hosted IBM Plex fonts', () => {
    test('regression: nothing loads fonts from Google at build time', () => {
        // next/font/google failed builds whenever Google returned font URLs
        // Turbopack cannot parse; see README.md in this folder.
        const offenders = sourceFiles(srcDir).filter((file) => /from\s+["']next\/font\/google["']/.test(readFileSync(file, 'utf8')));
        assert.deepStrictEqual(offenders, []);
    });

    for (const { family, folder, weights, subsets } of FAMILIES) {
        test(`${family} has one call per Google subset, in Google's order, with every weight`, () => {
            const familyCalls = calls.filter((call) => call.family === family);
            assert.deepStrictEqual(familyCalls.map((call) => subsetOf(call.files[0].path)), subsets);
            for (const call of familyCalls) {
                assert.deepStrictEqual(call.files.map((file) => file.weight), weights, call.name);
                for (const file of call.files) {
                    assert.ok(file.path.startsWith(`./${folder}/`), `${call.name}: ${file.path}`);
                    assert.strictEqual(subsetOf(file.path), subsetOf(call.files[0].path), `${call.name}: ${file.path}`);
                }
            }
        });
    }

    test('every call names its family and unicode-range', () => {
        assert.strictEqual(calls.length, 11);
        for (const call of calls) {
            assert.ok(FAMILIES.some(({ family }) => family === call.family), `${call.name}: ${call.family}`);
            assert.match(call.unicodeRange, /^U\+[0-9A-F]{4}/, call.name);
        }
    });

    test('a subset has the same unicode-range in both families', () => {
        const rangeBySubset = new Map<string, string>();
        for (const call of calls) {
            const subset = subsetOf(call.files[0].path);
            const range = rangeBySubset.get(subset) ?? call.unicodeRange;
            assert.strictEqual(call.unicodeRange, range, call.name);
            rangeBySubset.set(subset, range);
        }
        assert.ok(rangeBySubset.get('latin')!.startsWith('U+0000-00FF,'));
    });

    test('only the Latin files are preloaded', () => {
        for (const call of calls) {
            assert.strictEqual(call.preload, subsetOf(call.files[0].path) === 'latin', call.name);
        }
    });

    test('every referenced file is a WOFF2 font in this folder, and no file is unused', () => {
        const referenced = new Set(calls.flatMap((call) => call.files.map((file) => file.path.replace(/^\.\//, ''))));
        const onDisk = FAMILIES.flatMap(({ folder }) => readdirSync(join(fontsDir, folder)).map((name) => `${folder}/${name}`));
        assert.deepStrictEqual([...referenced].sort(), onDisk.sort());
        for (const file of onDisk) {
            assert.strictEqual(readFileSync(join(fontsDir, file)).subarray(0, 4).toString('latin1'), 'wOF2', file);
        }
    });

    test('the CSS variables use each family with a metric-matched fallback that is defined', () => {
        for (const { family } of FAMILIES) {
            const variable = family === 'IBM Plex Sans' ? '--font-app-sans' : '--font-app-mono';
            assert.ok(css.includes(`${variable}: "${family}", "${family} Fallback";`), variable);
            assert.match(css, new RegExp(`@font-face \\{\\s*font-family: "${family} Fallback";\\s*src: local\\("Arial"\\);`));
        }
    });
});
