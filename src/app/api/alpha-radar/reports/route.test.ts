import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { GET } from './route';

const FILER_ID = '00000000-0000-4000-8000-000000000001';

// Which reports come back is in scripts/db/alpha-radar-follows.test.ts.
describe('GET /api/alpha-radar/reports', () => {
    test('refuses filer IDs that aren\'t a list of UUIDs before the database is asked', async () => {
        for (const ids of ['', 'berkshire-hathaway', `${FILER_ID},`, Array.from({ length: 101 }, () => FILER_ID).join(',')]) {
            const response = await GET(new NextRequest(`https://atlas.test/api/alpha-radar/reports?trackedFilerIds=${encodeURIComponent(ids)}`));
            assert.equal(response.status, 400, ids);
            assert.equal((await response.json()).code, 'INVALID_TRACKED_FILER_IDS');
        }
    });
});
