import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import {
    alphaRadarQueryKeys,
    fetchAlphaRadarFilers,
    fetchAlphaRadarHoldings,
    fetchAlphaRadarReports,
    refreshAlphaRadarFiler,
    searchAlphaRadarMemory,
} from './queries';

const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return Response.json({ data: [{ id: 'filer-1', name: 'Berkshire Hathaway Inc' }] });
    }) as typeof fetch;
});

describe('alphaRadarQueryKeys', () => {
    test('builds stable keys for nested filer resources', () => {
        assert.deepStrictEqual(alphaRadarQueryKeys.filers(), ['alpha-radar', 'filers']);
        assert.deepStrictEqual(
            alphaRadarQueryKeys.holdings('filer-1', undefined, '2025-Q4'),
            ['alpha-radar', 'filers', 'filer-1', 'holdings', 'latest', '2025-Q4'],
        );
    });

    test('keys reports from several filers by the filers, in any order', () => {
        assert.deepStrictEqual(alphaRadarQueryKeys.reports(), ['alpha-radar', 'reports', 'all', 'latest']);
        assert.deepStrictEqual(
            alphaRadarQueryKeys.reports(undefined, undefined, ['filer-2', 'filer-1']),
            ['alpha-radar', 'reports', 'all', 'latest', 'filers', 'filer-1,filer-2'],
        );
        assert.deepStrictEqual(
            alphaRadarQueryKeys.reports(undefined, undefined, ['filer-1', 'filer-2']),
            alphaRadarQueryKeys.reports(undefined, undefined, ['filer-2', 'filer-1']),
        );
    });
});

describe('Alpha Radar API fetchers', () => {
    test('fetches tracked filers from the app-native route', async () => {
        const filers = await fetchAlphaRadarFilers();

        assert.strictEqual(calls[0].url, '/api/alpha-radar/filers');
        assert.strictEqual(filers[0].name, 'Berkshire Hathaway Inc');
    });

    test('asks for the reports of the filers followed by ID', async () => {
        await fetchAlphaRadarReports({ trackedFilerIds: ['filer-1', 'filer-2'] });

        assert.strictEqual(calls[0].url, '/api/alpha-radar/reports?trackedFilerIds=filer-1%2Cfiler-2');
    });

    test('encodes holdings route parameters', async () => {
        await fetchAlphaRadarHoldings({
            filerId: 'berkshire/hathaway',
            reportPeriod: '2025-Q4',
        });

        assert.strictEqual(
            calls[0].url,
            '/api/alpha-radar/filers/berkshire%2Fhathaway/holdings?reportPeriod=2025-Q4',
        );
    });

    test('encodes semantic memory search filters', async () => {
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init });
            return Response.json({ data: { provider: 'keyword-fallback', matches: [] } });
        }) as typeof fetch;

        const result = await searchAlphaRadarMemory({
            query: 'AI infrastructure',
            trackedFilerId: 'filer-1',
            reportPeriod: '2025-Q4',
            limit: 3,
        });

        assert.strictEqual(
            calls[0].url,
            '/api/alpha-radar/memory/search?query=AI+infrastructure&trackedFilerId=filer-1&reportPeriod=2025-Q4&limit=3',
        );
        assert.strictEqual(result.provider, 'keyword-fallback');
    });

    test('posts refresh requests and returns structured run data', async () => {
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init });
            return Response.json({ data: { scope: 'filer', totalFilers: 1, errors: [] } });
        }) as typeof fetch;

        const result = await refreshAlphaRadarFiler('filer-1', { force: true, filingLimit: 2 });

        assert.strictEqual(calls[0].url, '/api/alpha-radar/filers/filer-1/refresh');
        assert.strictEqual(calls[0].init?.method, 'POST');
        assert.strictEqual(calls[0].init?.body, JSON.stringify({ force: true, filingLimit: 2 }));
        assert.strictEqual(result.scope, 'filer');
    });

    test('throws API error messages for failed responses', async () => {
        globalThis.fetch = (async () => Response.json({ error: 'No filer' }, { status: 404 })) as typeof fetch;

        await assert.rejects(() => fetchAlphaRadarFilers(), /No filer/);
    });
});
