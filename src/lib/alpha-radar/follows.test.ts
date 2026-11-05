import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildListFollowedFilersQuery } from './follows';

// What is stored and for whom runs against Postgres in
// scripts/db/alpha-radar-follows.test.ts.
describe('the filers a user follows', () => {
    test('are read for that user alone, with each filer\'s name, by name', () => {
        const query = buildListFollowedFilersQuery('user-a').toSQL();

        assert.match(query.sql, /from "alpha_radar_filer_follows" inner join "alpha_radar_tracked_filers" on "alpha_radar_tracked_filers"\."id" = "alpha_radar_filer_follows"\."tracked_filer_id"/);
        assert.match(query.sql, /where "alpha_radar_filer_follows"\."user_id" = \$1/);
        assert.match(query.sql, /order by "alpha_radar_tracked_filers"\."name" asc, "alpha_radar_filer_follows"\."tracked_filer_id" asc$/);
        assert.deepEqual(query.params, ['user-a']);
    });
});
