import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    ALL_DESTINATIONS,
    LEGACY_REDIRECTS,
    PRIMARY_NAV,
    SYSTEM_NAV,
    activeDestination,
    activeSectionTab,
    isActiveHref,
    sectionTabsFor,
} from './navigation';

describe('navigation', () => {
    test('primary nav is the eight-destination IA minus settings', () => {
        assert.deepStrictEqual(
            PRIMARY_NAV.map((d) => d.title),
            ['Today', 'Portfolio', 'Performance', 'Research', 'Strategies', 'Trade', 'Ask'],
        );
        assert.deepStrictEqual(SYSTEM_NAV.map((d) => d.title), ['Settings', 'Help']);
    });

    test('every destination has a unique id and href', () => {
        const ids = new Set(ALL_DESTINATIONS.map((d) => d.id));
        const hrefs = new Set(ALL_DESTINATIONS.map((d) => d.href));
        assert.strictEqual(ids.size, ALL_DESTINATIONS.length);
        assert.strictEqual(hrefs.size, ALL_DESTINATIONS.length);
    });

    test('isActiveHref: root only matches itself', () => {
        assert.strictEqual(isActiveHref('/', '/'), true);
        assert.strictEqual(isActiveHref('/', '/research'), false);
    });

    test('isActiveHref: prefixes match nested paths but not siblings', () => {
        assert.strictEqual(isActiveHref('/research', '/research/thesis/NVDA'), true);
        assert.strictEqual(isActiveHref('/research', '/researcher'), false);
        assert.strictEqual(isActiveHref('/research?tab=journal', '/research'), true);
    });

    test('activeDestination maps every portfolio view to Portfolio', () => {
        for (const path of ['/portfolios/holdings', '/portfolios/accounts', '/portfolios/activity', '/portfolios/detail/AAPL']) {
            assert.strictEqual(activeDestination(path)?.id, 'portfolio', path);
        }
    });

    test('activeDestination handles Today, Trade, and unknown routes', () => {
        assert.strictEqual(activeDestination('/')?.id, 'today');
        assert.strictEqual(activeDestination('/execution')?.id, 'trade');
        assert.strictEqual(activeDestination('/login'), null);
    });

    test('sectionTabsFor returns Portfolio and Performance tabs, none elsewhere', () => {
        assert.deepStrictEqual(sectionTabsFor('/portfolios/activity').map((t) => t.label), ['Holdings', 'Accounts', 'Activity']);
        assert.deepStrictEqual(sectionTabsFor('/performance').map((t) => t.label), ['Returns', 'Behaviour']);
        assert.deepStrictEqual(sectionTabsFor('/research'), []);
    });

    test('activeSectionTab picks the most specific tab', () => {
        assert.strictEqual(activeSectionTab('/performance')?.label, 'Returns');
        assert.strictEqual(activeSectionTab('/performance/behaviour')?.label, 'Behaviour');
        assert.strictEqual(activeSectionTab('/portfolios/accounts')?.label, 'Accounts');
    });

    test('position detail keeps the Holdings tab selected', () => {
        assert.strictEqual(activeSectionTab('/portfolios/detail/AAPL')?.label, 'Holdings');
    });

    test('activeSectionTab is null outside tabbed sections', () => {
        assert.strictEqual(activeSectionTab('/research'), null);
    });

    test('legacy redirects all land on a live destination', () => {
        const sources = LEGACY_REDIRECTS.map((r) => r.source);
        assert.deepStrictEqual(sources.sort(), [
            '/analytics',
            '/portfolios',
            '/portfolios/trade-log',
            '/research/journal',
            '/strategies/builder',
            '/strategies/deploy',
        ]);
        for (const { source, destination } of LEGACY_REDIRECTS) {
            assert.notStrictEqual(source, destination);
            assert.ok(activeDestination(destination.split('?')[0]), `${destination} has no destination`);
        }
    });
});
