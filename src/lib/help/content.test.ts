import { test, describe } from 'node:test';
import assert from 'node:assert';
import { activeDestination } from '@/lib/navigation';
import { GETTING_STARTED, GLOSSARY } from './content';

const path = (href: string) => href.split(/[?#]/)[0];

describe('help content', () => {
    test('getting started is five steps, each linking to a live page', () => {
        assert.strictEqual(GETTING_STARTED.length, 5);
        for (const step of GETTING_STARTED) assert.ok(activeDestination(path(step.href)), step.href);
    });

    test('glossary terms are unique, alphabetical (numbers last), and link to live pages', () => {
        const terms = GLOSSARY.map((g) => g.term);
        assert.strictEqual(new Set(terms).size, terms.length);
        const letters = terms.filter((t) => /^[A-Za-z]/.test(t));
        assert.deepStrictEqual(letters, [...letters].sort((a, b) => a.localeCompare(b)));
        for (const g of GLOSSARY) if (g.href) assert.ok(activeDestination(path(g.href)), g.href);
    });

    test('defines the policy terms the review found unexplained', () => {
        for (const t of ['Bucket', 'Churn', 'Re-underwrite']) assert.ok(GLOSSARY.some((g) => g.term === t), t);
    });
});
