import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SMALL_POSITIONS_RULE } from '@/lib/holdings/small-positions';
import { activeDestination } from '@/lib/navigation';
import { GLOSSARY, gettingStarted } from './content';

const path = (href: string) => href.split(/[?#]/)[0];

describe('help content', () => {
    test('getting started is five steps, each linking to a live page, with bank linking or without', () => {
        for (const bankLinking of [false, true]) {
            const steps = gettingStarted(bankLinking);
            assert.strictEqual(steps.length, 5);
            for (const step of steps) assert.ok(activeDestination(path(step.href)), step.href);
        }
    });

    // x30: step one sent everyone to Settings to connect an account, where
    // without Plaid's keys the card only says bank linking isn't set up and
    // points back at Accounts.
    test('regression (x30): without bank linking, step one adds an account by hand on Accounts', () => {
        const [first, ...rest] = gettingStarted(false);
        assert.strictEqual(first.href, '/portfolios/accounts');
        assert.strictEqual(first.cta, 'Add an account');
        assert.doesNotMatch(`${first.title} ${first.body}`, /connect|link a brokerage/i);
        for (const step of [first, ...rest]) assert.notStrictEqual(step.href, '/settings#accounts', step.title);
    });

    test('with bank linking, step one connects a brokerage in Settings', () => {
        const [first] = gettingStarted(true);
        assert.strictEqual(first.href, '/settings#accounts');
        assert.strictEqual(first.cta, 'Connect an account');
        // A linked account's option contracts sync with it (launch item i63).
        assert.match(first.body, /holdings, option positions, cash, and transactions/);
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
        // A holding valued by hand takes a bucket too, core until one is chosen.
        assert.match(GLOSSARY.find((g) => g.term === 'Bucket')?.definition ?? '', /\(one valued by hand in core\) until you choose another in Settings\.$/);
    });

    test('defines the terms Accounts splits your value by, each linking there', () => {
        for (const t of ['Tax treatment', 'Ownership']) {
            const entry = GLOSSARY.find((g) => g.term === t);
            assert.ok(entry, t);
            assert.strictEqual(entry.href, '/portfolios/accounts', t);
            assert.match(entry.definition, /Accounts splits your value by it\.$/, t);
        }
    });

    test('says what the portfolio value counts, and that the risk policy adds option positions to it', () => {
        const definition = GLOSSARY.find((g) => g.term === 'Portfolio value')?.definition ?? '';
        // As policyPortfolioValue measures it: bought options at their worth, written ones less their cost to buy back.
        assert.match(definition, /^What your accounts hold: positions at their latest prices, holdings valued by hand, and cash\./);
        assert.match(definition, /the risk policy’s checks add them: what bought options are worth, less what written ones would cost to buy back\.$/);
        assert.doesNotMatch(definition, /the risk policy measure this/);
    });

    test('names every source of a value given by hand: the user, a positions file and a linked account', () => {
        const definition = GLOSSARY.find((g) => g.term === 'Valued by hand')?.definition ?? '';
        assert.match(definition, /given by you, your broker’s positions file or your linked account, as of its date/);
    });

    test('defines Small positions with the rule\'s own limits, linking to Holdings', () => {
        const entry = GLOSSARY.find((g) => g.term === 'Small positions');
        assert.ok(entry);
        assert.strictEqual(entry.href, '/portfolios/holdings');
        assert.deepStrictEqual({ ...SMALL_POSITIONS_RULE }, { maxValue: 500, maxShare: 0.005, minCount: 3 });
        assert.strictEqual(
            entry.definition,
            'On Holdings, positions each worth under $500 and under 0.5% of your market value are shown together in one row you can open, once there are three or more. Every total still counts them.',
        );
    });
});
