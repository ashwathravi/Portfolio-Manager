import { describe, test } from 'node:test';
import assert from 'node:assert';
import { SecEdgarClient, type SecEdgarClientOptions, type SecFetch } from './edgar-client';
import { SecEdgarError } from './types';

const TRACKED_FILER_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        statusText: init.statusText,
        headers: {
            'content-type': 'application/json',
            ...(init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers),
        },
    });
}

function submissionsResponse(overrides: Record<string, unknown> = {}) {
    return {
        cik: '0001067983',
        name: 'BERKSHIRE HATHAWAY INC',
        filings: {
            recent: {
                accessionNumber: [
                    '0000950123-26-000001',
                    '0000950123-26-000002',
                    '0000950123-26-000003',
                ],
                filingDate: ['2026-02-14', '2026-01-10', '2025-11-15'],
                reportDate: ['2025-12-31', '2025-09-30', '2025-09-30'],
                acceptanceDateTime: [
                    '2026-02-14T20:12:05.000',
                    '2026-01-10T18:00:00.000',
                    '2025-11-15T17:30:00.000',
                ],
                form: ['13F-HR', '10-Q', '13F-HR/A'],
                primaryDocument: ['primary.xml', 'form10q.htm', 'amendment.xml'],
                primaryDocDescription: ['INFORMATION TABLE', 'FORM 10-Q', 'INFORMATION TABLE'],
                ...overrides,
            },
        },
    };
}

function clientFor(
    fetcher: SecFetch,
    sleep: (ms: number) => Promise<void> = async () => undefined,
    options: Partial<SecEdgarClientOptions> = {},
) {
    return new SecEdgarClient({
        userAgent: 'Atlas Wealth test contact@example.com',
        fetcher,
        sleep,
        minRequestIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 5,
        ...options,
    });
}

describe('SecEdgarClient', () => {
    test('fetches recent 13F metadata from fixture-backed submissions JSON', async () => {
        const requests: Array<{ url: string; userAgent: string | null }> = [];
        const fetcher: SecFetch = async (url, init) => {
            requests.push({
                url,
                userAgent: new Headers(init.headers).get('user-agent'),
            });
            return jsonResponse(submissionsResponse());
        };

        const client = clientFor(fetcher);
        const filings = await client.fetchRecent13FFilings({
            trackedFilerId: TRACKED_FILER_ID,
            cik: '1067983',
        });

        assert.strictEqual(requests.length, 1);
        assert.strictEqual(requests[0].url, 'https://data.sec.gov/submissions/CIK0001067983.json');
        assert.strictEqual(requests[0].userAgent, 'Atlas Wealth test contact@example.com');
        assert.strictEqual(filings.length, 2);
        assert.strictEqual(filings[0].accessionNumber, '0000950123-26-000001');
        assert.strictEqual(filings[0].filingType, '13F-HR');
        assert.strictEqual(filings[0].reportPeriod, '2025-Q4');
        assert.strictEqual(
            filings[0].primaryDocumentUrl,
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/primary.xml',
        );
        assert.strictEqual(filings[0].informationTableUrl, filings[0].primaryDocumentUrl);
        assert.strictEqual(filings[1].filingType, '13F-HR/A');
    });

    test('discovers a separate 13F information table attachment from the filing archive index', async () => {
        const requests: string[] = [];
        const fetcher: SecFetch = async (url) => {
            requests.push(url);
            if (url === 'https://data.sec.gov/submissions/CIK0001067983.json') {
                return jsonResponse(submissionsResponse({
                    accessionNumber: ['0000950123-26-000001'],
                    filingDate: ['2026-02-14'],
                    reportDate: ['2025-12-31'],
                    acceptanceDateTime: ['2026-02-14T20:12:05.000'],
                    form: ['13F-HR'],
                    primaryDocument: ['form13f.htm'],
                    primaryDocDescription: ['13F-HR'],
                }));
            }

            if (url === 'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/index.json') {
                return jsonResponse({
                    directory: {
                        item: [
                            { name: 'form13f.htm', type: '13F-HR' },
                            { name: 'primary_doc.xml', type: 'XML' },
                            { name: 'form13fInfoTable.xml', type: 'INFORMATION TABLE' },
                        ],
                    },
                });
            }

            return jsonResponse({ message: 'unexpected url' }, { status: 404 });
        };

        const client = clientFor(fetcher);
        const filings = await client.fetchRecent13FFilings({
            trackedFilerId: TRACKED_FILER_ID,
            cik: '1067983',
        });

        assert.deepStrictEqual(requests, [
            'https://data.sec.gov/submissions/CIK0001067983.json',
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/index.json',
        ]);
        assert.strictEqual(filings.length, 1);
        assert.strictEqual(
            filings[0].primaryDocumentUrl,
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/form13f.htm',
        );
        assert.strictEqual(
            filings[0].informationTableUrl,
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/form13fInfoTable.xml',
        );
    });

    test('keeps filing metadata when optional information table attachment discovery is unavailable', async () => {
        const requests: string[] = [];
        const fetcher: SecFetch = async (url) => {
            requests.push(url);
            if (url === 'https://data.sec.gov/submissions/CIK0001067983.json') {
                return jsonResponse(submissionsResponse({
                    accessionNumber: ['0000950123-26-000001'],
                    filingDate: ['2026-02-14'],
                    reportDate: ['2025-12-31'],
                    acceptanceDateTime: ['2026-02-14T20:12:05.000'],
                    form: ['13F-HR'],
                    primaryDocument: ['form13f.htm'],
                    primaryDocDescription: ['13F-HR'],
                }));
            }

            return jsonResponse({ message: 'missing index' }, { status: 404 });
        };

        const client = clientFor(fetcher);
        const filings = await client.fetchRecent13FFilings({
            trackedFilerId: TRACKED_FILER_ID,
            cik: '0001067983',
        });

        assert.deepStrictEqual(requests, [
            'https://data.sec.gov/submissions/CIK0001067983.json',
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/index.json',
        ]);
        assert.strictEqual(filings.length, 1);
        assert.strictEqual(
            filings[0].primaryDocumentUrl,
            'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/form13f.htm',
        );
        assert.strictEqual(filings[0].informationTableUrl, undefined);
    });

    test('resolves configured numeric CIKs without making a network request', async () => {
        let called = false;
        const fetcher: SecFetch = async () => {
            called = true;
            return jsonResponse({});
        };

        const client = clientFor(fetcher);
        const match = await client.resolveCik('1067983');

        assert.strictEqual(match.cik, '0001067983');
        assert.strictEqual(called, false);
    });

    test('resolves filer names and tickers through SEC company ticker fixtures', async () => {
        const fetcher: SecFetch = async () => jsonResponse({
            0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
            1: { cik_str: 1067983, ticker: 'BRK-A', title: 'Berkshire Hathaway Inc' },
        });

        const client = clientFor(fetcher);

        assert.deepStrictEqual(await client.resolveCik('BRK-A'), {
            cik: '0001067983',
            name: 'Berkshire Hathaway Inc',
            ticker: 'BRK-A',
        });
        assert.strictEqual((await client.resolveCik('berkshire hathaway')).cik, '0001067983');
    });

    test('returns actionable missing CIK errors when company lookup has no match', async () => {
        const fetcher: SecFetch = async () => jsonResponse({
            0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        });

        const client = clientFor(fetcher);

        await assert.rejects(
            () => client.resolveCik('Missing Capital'),
            (error: unknown) => error instanceof SecEdgarError
                && error.code === 'not_found'
                && error.message.includes('No SEC CIK match'),
        );
    });

    test('retries SEC rate limit responses before returning filings', async () => {
        const sleeps: number[] = [];
        let calls = 0;
        const fetcher: SecFetch = async () => {
            calls += 1;
            if (calls === 1) {
                return jsonResponse({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '2' } });
            }
            return jsonResponse(submissionsResponse());
        };

        const client = clientFor(fetcher, async (ms) => {
            sleeps.push(ms);
        });
        const filings = await client.fetchRecent13FFilings({
            trackedFilerId: TRACKED_FILER_ID,
            cik: '0001067983',
        });

        assert.strictEqual(calls, 2);
        assert.deepStrictEqual(sleeps, [2000]);
        assert.strictEqual(filings.length, 2);
    });

    test('sends an abort signal and rejects oversized SEC JSON responses', async () => {
        let sawAbortSignal = false;
        const fetcher: SecFetch = async (_url, init) => {
            sawAbortSignal = init.signal instanceof AbortSignal;
            return jsonResponse({ tooLarge: true }, {
                headers: { 'content-length': '100' },
            });
        };

        const client = clientFor(fetcher, async () => undefined, {
            requestTimeoutMs: 50,
            maxJsonResponseBytes: 10,
        });

        await assert.rejects(
            () => client.fetchRecent13FFilings({ trackedFilerId: TRACKED_FILER_ID, cik: '0001067983' }),
            (error: unknown) => error instanceof SecEdgarError
                && error.code === 'malformed_response'
                && error.message.includes('exceeded configured safety limits'),
        );
        assert.strictEqual(sawAbortSignal, true);
    });

    test('surfaces malformed submissions responses as structured errors', async () => {
        const fetcher: SecFetch = async () => jsonResponse({
            cik: '0001067983',
            filings: { recent: { accessionNumber: ['0000950123-26-000001'] } },
        });

        const client = clientFor(fetcher);

        await assert.rejects(
            () => client.fetchRecent13FFilings({ trackedFilerId: TRACKED_FILER_ID, cik: '0001067983' }),
            (error: unknown) => error instanceof SecEdgarError
                && error.code === 'malformed_response'
                && error.message.includes('missing recent filing arrays'),
        );
    });

    test('returns an empty filing set when the filer has no recent 13F forms', async () => {
        const fetcher: SecFetch = async () => jsonResponse(submissionsResponse({
            accessionNumber: ['0000950123-26-000002'],
            filingDate: ['2026-01-10'],
            reportDate: ['2025-09-30'],
            acceptanceDateTime: ['2026-01-10T18:00:00.000'],
            form: ['10-Q'],
            primaryDocument: ['form10q.htm'],
        }));

        const client = clientFor(fetcher);
        const filings = await client.fetchRecent13FFilings({
            trackedFilerId: TRACKED_FILER_ID,
            cik: '0001067983',
        });

        assert.deepStrictEqual(filings, []);
    });
});
