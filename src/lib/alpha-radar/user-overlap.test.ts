import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { AlphaRadarMemoChange } from './memo';
import {
    applyAlphaRadarUserOverlap,
    listAlphaRadarChangesForUser,
    NO_USER_OVERLAP,
    type AlphaRadarChangeReader,
    type AlphaRadarUserOverlap,
} from './user-overlap';

const NONE = { portfolio: false, watchlist: false, thesis: false, reasons: [], matchedTickers: [], matchedCusips: [] };

function change(issuerName: string, cusip: string, materialityScore: number, extra: Partial<AlphaRadarMemoChange> = {}): AlphaRadarMemoChange {
    return {
        id: `change-${cusip}`,
        trackedFilerId: '11111111-1111-4111-8111-111111111111',
        reportPeriod: '2026-Q3',
        changeType: 'increased',
        issuerName,
        cusip,
        materialityScore,
        userRelevance: NONE,
        displayReason: `${issuerName} increased.`,
        ...extra,
    };
}

// As the 13F stores them: no tickers, and no overlap.
const APPLE = change('APPLE INC', '037833100', 40);
const CHUBB = change('CHUBB LIMITED', 'H1467J104', 60);
const ALPHABET_A = change('ALPHABET INC', '02079K305', 30);
const ALPHABET_C = change('ALPHABET INC', '02079K107', 20);
const HOSPITALITY = change('APPLE HOSPITALITY REIT INC', '03784Y200', 10);

const overlap = (partial: Partial<AlphaRadarUserOverlap>): AlphaRadarUserOverlap => ({ ...NO_USER_OVERLAP, ...partial });

describe('applyAlphaRadarUserOverlap', () => {
    test('a change matches what the user holds by company name when the 13F gave no ticker', () => {
        const [apple, hospitality] = applyAlphaRadarUserOverlap(
            [APPLE, HOSPITALITY],
            overlap({ portfolio: [{ ticker: 'AAPL', names: ['Apple Inc.'] }] }),
        );

        assert.equal(apple.cusip, APPLE.cusip);
        assert.deepEqual(apple.userRelevance, {
            portfolio: true, watchlist: false, thesis: false,
            reasons: ['Held in portfolio'], matchedTickers: ['AAPL'], matchedCusips: [],
        });
        assert.deepEqual(hospitality.userRelevance, NONE);
    });

    test('a ticker the 13F did give matches the user\'s ticker, whatever the name', () => {
        const [nvidia] = applyAlphaRadarUserOverlap(
            [change('NVIDIA CORPORATION COM', '67066G104', 50, { ticker: 'nvda' })],
            overlap({ watchlist: [{ ticker: 'NVDA', names: [] }] }),
        );
        assert.deepEqual(nvidia.userRelevance.reasons, ['On watchlist']);
        assert.deepEqual(nvidia.userRelevance.matchedTickers, ['NVDA']);
    });

    test('one change can meet the user three ways; a company matches each of its share classes', () => {
        const changes = applyAlphaRadarUserOverlap(
            [ALPHABET_A, ALPHABET_C, CHUBB],
            overlap({
                portfolio: [{ ticker: 'GOOGL', names: ['Alphabet Inc.'] }, { ticker: 'GOOG', names: ['Alphabet Inc.'] }],
                watchlist: [{ ticker: 'GOOGL', names: ['Alphabet Inc.'] }],
                thesis: [{ ticker: 'CB', names: ['Chubb Ltd'] }],
            }),
        );
        const byCusip = new Map(changes.map((item) => [item.cusip, item.userRelevance]));

        for (const cusip of [ALPHABET_A.cusip, ALPHABET_C.cusip]) {
            assert.deepEqual(byCusip.get(cusip)?.reasons, ['Held in portfolio', 'On watchlist'], cusip);
            assert.deepEqual(byCusip.get(cusip)?.matchedTickers, ['GOOG', 'GOOGL'], cusip);
        }
        assert.deepEqual(byCusip.get(CHUBB.cusip)?.reasons, ['Linked to active thesis']);
    });

    test('scores each change as the ingest would have with the user\'s overlap, and ranks by it', () => {
        const changes = applyAlphaRadarUserOverlap(
            [CHUBB, APPLE, ALPHABET_A, change('VERY MATERIAL CO', '000000001', 95)],
            overlap({
                portfolio: [{ ticker: 'AAPL', names: ['Apple Inc.'] }, { ticker: 'VMC', names: ['Very Material Co'] }],
                watchlist: [{ ticker: 'AAPL', names: ['Apple Inc.'] }],
                thesis: [{ ticker: 'AAPL', names: ['APPLE INC'] }],
            }),
        );

        // Apple: 40 + 12 + 7 + 7. Very Material: 95 + 12, capped at 100.
        assert.deepEqual(changes.map((item) => [item.issuerName, item.materialityScore]), [
            ['VERY MATERIAL CO', 100],
            ['APPLE INC', 66],
            ['CHUBB LIMITED', 60],
            ['ALPHABET INC', 30],
        ]);
    });

    test('regression: what was stored is replaced, so one user\'s overlap never shows for another', () => {
        const stored = change('APPLE INC', '037833100', 52, {
            userRelevance: { ...NONE, portfolio: true, reasons: ['Held in portfolio'], matchedTickers: ['AAPL'] },
        });
        const [apple] = applyAlphaRadarUserOverlap([stored], NO_USER_OVERLAP);
        assert.deepEqual(apple.userRelevance, NONE);
        assert.equal(apple.materialityScore, 52);
    });

    test('ties keep the order they came in, and nothing is changed in place', () => {
        const first = change('FIRST CO', '000000002', 50);
        const second = change('SECOND CO', '000000003', 50);
        const changes = applyAlphaRadarUserOverlap([first, second], NO_USER_OVERLAP);
        assert.deepEqual(changes.map((item) => item.issuerName), ['FIRST CO', 'SECOND CO']);
        assert.notEqual(changes[0], first);
        assert.deepEqual(first.userRelevance, NONE);
    });
});

/** A filer's stored changes, read as the repository reads them, with each read recorded. */
function storedChanges(changes: readonly AlphaRadarMemoChange[]) {
    const stored = [...changes].sort((a, b) => b.materialityScore - a.materialityScore || a.issuerName.localeCompare(b.issuerName));
    const reads: string[] = [];
    const reader: AlphaRadarChangeReader = {
        async listHoldingChanges({ ids, limit = 100 }) {
            reads.push(ids ? `changes ${ids.join(',')}` : `top ${limit}`);
            return stored.filter((item) => !ids || ids.includes(item.id!)).slice(0, limit);
        },
        async listHoldingChangeRanks({ minScore }) {
            reads.push(`ranks from ${minScore}`);
            return stored
                .filter((item) => item.materialityScore >= minScore)
                .map(({ id, issuerName, ticker, materialityScore }) => ({ id: id!, issuerName, ticker, materialityScore }));
        },
    };
    return { reader, reads };
}

const QUERY = { trackedFilerId: '11111111-1111-4111-8111-111111111111' };
const HOLDS_APPLE = overlap({ portfolio: [{ ticker: 'AAPL', names: ['Apple Inc.'] }] });

describe('listAlphaRadarChangesForUser', () => {
    test('regression (i61): the limit is applied after the user\'s ranking, not to the stored one', async () => {
        // Chubb is the stored top change, but Apple, held, is the user's: 50 + 12.
        const { reader } = storedChanges([CHUBB, change('APPLE INC', '037833100', 50), HOSPITALITY]);
        const changes = await listAlphaRadarChangesForUser(reader, { ...QUERY, limit: 1 }, HOLDS_APPLE);
        assert.deepEqual(changes.map((item) => [item.issuerName, item.materialityScore, item.userRelevance.reasons]), [
            ['APPLE INC', 62, ['Held in portfolio']],
        ]);
    });

    test('reads in full only the changes the user\'s overlap could lift into the limit', async () => {
        const { reader, reads } = storedChanges([
            CHUBB,
            change('MICROSOFT CORP', '594918104', 45),
            change('APPLE INC', '037833100', 40),
            change('ALPHABET INC', '02079K305', 15),
        ]);
        const changes = await listAlphaRadarChangesForUser(reader, { ...QUERY, limit: 2 }, overlap({
            portfolio: [{ ticker: 'AAPL', names: ['Apple Inc.'] }, { ticker: 'GOOGL', names: ['Alphabet Inc.'] }],
        }));

        // The overlap adds at most 26, so a change below 45 - 26 can't pass
        // Microsoft: Alphabet, held but at 15, is never read.
        assert.deepEqual(reads, ['top 2', 'ranks from 19', 'changes change-037833100']);
        assert.deepEqual(changes.map((item) => [item.issuerName, item.materialityScore]), [
            ['CHUBB LIMITED', 60],
            ['APPLE INC', 52],
        ]);
    });

    test('a change lifted only to tie the last of the stored top stays behind it', async () => {
        const { reader } = storedChanges([change('MICROSOFT CORP', '594918104', 52), change('APPLE INC', '037833100', 40)]);
        const changes = await listAlphaRadarChangesForUser(reader, { ...QUERY, limit: 1 }, HOLDS_APPLE);
        assert.deepEqual(changes.map((item) => item.issuerName), ['MICROSOFT CORP']);
    });

    test('reads nothing more when every change fits in the limit or the user has no overlap', async () => {
        const all = storedChanges([CHUBB, change('APPLE INC', '037833100', 50), HOSPITALITY]);
        const changes = await listAlphaRadarChangesForUser(all.reader, { ...QUERY, limit: 5 }, HOLDS_APPLE);
        assert.deepEqual(all.reads, ['top 5']);
        assert.deepEqual(changes.map((item) => item.issuerName), ['APPLE INC', 'CHUBB LIMITED', 'APPLE HOSPITALITY REIT INC']);

        const none = storedChanges([CHUBB, APPLE, HOSPITALITY]);
        assert.deepEqual((await listAlphaRadarChangesForUser(none.reader, { ...QUERY, limit: 1 }, NO_USER_OVERLAP))
            .map((item) => item.issuerName), ['CHUBB LIMITED']);
        assert.deepEqual(none.reads, ['top 1']);
    });
});
