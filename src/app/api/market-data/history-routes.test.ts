import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { historyRangeSchema, timeframeSchema } from '@/lib/validators/market-data';

import { GET as getHistorical } from './historical/route';
import { GET as getHistory } from './history/route';

// Which bars each range covers is in src/lib/providers/polygon-massive-adapter.test.ts.
describe('GET /api/market-data/history and /historical (x22)', () => {
    before(() => {
        // No provider key: an accepted range reaches the provider, which refuses before any request.
        delete process.env.POLYGON_API_KEY;
    });

    test('every range /history accepts reaches the provider', async () => {
        for (const range of historyRangeSchema.options) {
            const response = await getHistory(new NextRequest(`https://atlas.test/api/market-data/history?symbol=AAPL&range=${range}`));
            assert.equal(response.status, 503, range);
            assert.equal((await response.json()).code, 'MARKET_DATA_NOT_CONFIGURED', range);
        }
    });

    test('every timeframe /historical accepts reaches the provider', async () => {
        for (const timeframe of timeframeSchema.options) {
            const response = await getHistorical(new NextRequest(`https://atlas.test/api/market-data/historical?symbol=AAPL&timeframe=${timeframe}`));
            assert.equal(response.status, 503, timeframe);
            assert.equal((await response.json()).code, 'MARKET_DATA_NOT_CONFIGURED', timeframe);
        }
    });

    test('regression: an hour of intraday bars is refused, not answered with a year of daily ones', async () => {
        const response = await getHistorical(new NextRequest('https://atlas.test/api/market-data/historical?symbol=AAPL&timeframe=1H'));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Invalid timeframe. Valid values: 1D, 1M', code: 'INVALID_TIMEFRAME' });
    });

    test('/history refuses a range it has no window for', async () => {
        const response = await getHistory(new NextRequest('https://atlas.test/api/market-data/history?symbol=AAPL&range=10Y'));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'INVALID_RANGE');
    });
});
