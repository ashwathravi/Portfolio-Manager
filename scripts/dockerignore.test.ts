import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const patterns = readFileSync('.dockerignore', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

test('.dockerignore - keeps secrets out of the image', () => {
    for (const pattern of ['.env', '.env.*', '.runtime']) {
        assert.ok(patterns.includes(pattern), `${pattern} is not ignored`);
    }
    // Only the example files come back in.
    assert.deepStrictEqual(patterns.filter((pattern) => pattern.startsWith('!')), ['!.env.example', '!.env*.example']);
});

test('.dockerignore - regression: keeps agent worktrees out of the build context', () => {
    // .claude/worktrees holds full checkouts with their own node_modules:
    // 26 GB on one machine, enough to fill Docker's disk before the build began.
    assert.ok(patterns.includes('.claude'), '.claude is not ignored');
});

test('.dockerignore - keeps installs, build output and test reports out of the build context', () => {
    for (const pattern of ['node_modules', '.next', '.git', 'playwright-report*', 'test-results', 'coverage']) {
        assert.ok(patterns.includes(pattern), `${pattern} is not ignored`);
    }
});
