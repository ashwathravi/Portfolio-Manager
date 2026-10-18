import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// COMPOSE_PROJECT_NAME and friends would mask what docker-compose.yml says.
const env = { ...process.env };
for (const key of Object.keys(env).filter((name) => name.startsWith('COMPOSE_'))) {
    delete env[key];
}
const composeInstalled = spawnSync('docker', ['compose', 'version']).status === 0;

function compose(directory: string, ...args: string[]) {
    const result = spawnSync('docker', ['compose', ...args], { cwd: directory, env, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout;
}

test('docker-compose.yml - a git worktree shares the main checkout\'s container and volume', { skip: !composeInstalled && 'docker compose is not installed' }, () => {
    // Worktrees live at .claude/worktrees/<name>. Named after that directory,
    // the project would want a second container called atlas-wealth-db.
    const root = mkdtempSync(path.join(tmpdir(), 'compose-test-'));
    try {
        const worktree = path.join(root, '.claude', 'worktrees', 'some-worktree');
        mkdirSync(worktree, { recursive: true });
        copyFileSync('docker-compose.yml', path.join(worktree, 'docker-compose.yml'));

        for (const directory of [process.cwd(), worktree]) {
            const config = JSON.parse(compose(directory, 'config', '--format', 'json'));
            assert.strictEqual(config.name, 'portfolio-manager');
            assert.strictEqual(config.services.db.container_name, 'atlas-wealth-db');
            assert.strictEqual(config.volumes['atlas-wealth-db'].name, 'portfolio-manager_atlas-wealth-db');
        }

        // Compose recreates the container when this hash changes. If it depended
        // on the checkout's path, every checkout's `up` would restart Postgres
        // under the others.
        assert.strictEqual(compose(worktree, 'config', '--hash', 'db'), compose(process.cwd(), 'config', '--hash', 'db'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
