import { describe, test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const BARRIER = 'scripts/e2e/start-when-told.sh';

function start(...command: string[]) {
    const child = spawn('/bin/sh', [BARRIER, ...command], { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => {
        child.stdin.destroy();
        resolve(code);
    }));
    return { stdin: child.stdin, exited, stdout: () => stdout };
}

describe('start-when-told.sh', { timeout: 10_000 }, () => {
    test('runs the command with its arguments once told "go", with stdin closed', async () => {
        // `cat` would wait on the still-open pipe if stdin were passed through.
        const run = start('sh', '-c', 'echo "ran $1"; cat; exit 7', 'sh', 'with args');
        run.stdin.write('go\nnot for the command\n');
        assert.strictEqual(await run.exited, 7);
        assert.strictEqual(run.stdout(), 'ran with args\n');
    });

    test('never runs the command if stdin closes before "go"', async () => {
        const run = start('echo', 'ran');
        run.stdin.end();
        assert.strictEqual(await run.exited, 1);
        assert.strictEqual(run.stdout(), '');
    });

    test('never runs the command on anything but "go"', async () => {
        const run = start('echo', 'ran');
        run.stdin.end('gone\n');
        assert.strictEqual(await run.exited, 1);
        assert.strictEqual(run.stdout(), '');
    });
});
