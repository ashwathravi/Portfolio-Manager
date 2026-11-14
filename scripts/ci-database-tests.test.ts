import { describe, test } from 'node:test';
import assert from 'node:assert';
import { globSync, readFileSync } from 'node:fs';

// npm test skips the parts of a test that need SCRIPTS_TEST_DATABASE_URL, so
// such a test only ever runs with a database in the e2e-tests job's "Test the
// scripts that need a database" step. That step runs every scripts/db test
// through a pattern Node expands, so adding one there needs no workflow
// change; these checks keep a database test anywhere else from being skipped
// in CI without anyone noticing, as job-health.test.ts was while the step
// named each file.

const WORKFLOW = '.github/workflows/docker-build.yml';
const DATABASE_STEP = 'Test the scripts that need a database';
const INSTALL_STEP = 'Install the PostgreSQL client and age';
const VARIABLE = 'SCRIPTS_TEST_DATABASE_URL';
const THIS_FILE = 'scripts/ci-database-tests.test.ts';

/** The e2e-tests job's steps, by name, in order. */
function e2eSteps() {
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
    const start = lines.indexOf('  e2e-tests:');
    assert.notStrictEqual(start, -1, `${WORKFLOW} has no e2e-tests job`);
    const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
    const job = lines.slice(start, end === -1 ? undefined : end);

    const steps: { name: string; body: string }[] = [];
    for (const line of job) {
        if (/^ {6}- /.test(line)) steps.push({ name: line.match(/- name: (.+)$/)?.[1].trim() ?? '', body: '' });
        if (steps.length) steps[steps.length - 1].body += `${line}\n`;
    }
    return steps;
}

function databaseStep() {
    const step = e2eSteps().find((candidate) => candidate.name === DATABASE_STEP);
    assert.ok(step, `the e2e-tests job has no "${DATABASE_STEP}" step`);
    return step;
}

/** The files the step hands to `node --test`, as Node expands its patterns. */
function patterns() {
    const run = databaseStep().body.match(/^\s+run: (.+)$/m)?.[1];
    assert.ok(run, `"${DATABASE_STEP}" has no one-line run command`);
    const args = run.trim().split(/\s+/);
    assert.deepStrictEqual(args.slice(0, 4), ['node', '--import', 'tsx', '--test'], run);
    return args.slice(4).map((arg) => arg.replace(/^'(.*)'$/, '$1'));
}

describe('docker-build.yml - the tests that need a database', () => {
    test('runs every test that reads SCRIPTS_TEST_DATABASE_URL', () => {
        const ran = new Set(globSync(patterns()));
        const needDatabase = globSync(['scripts/**/*.test.ts', 'src/**/*.test.ts'])
            .filter((file) => file !== THIS_FILE && readFileSync(file, 'utf8').includes(VARIABLE))
            .sort();
        // Never vacuous: the lock's tests and the backup's are among them.
        assert.ok(needDatabase.includes('scripts/e2e/run-lock.test.ts'), needDatabase.join('\n'));
        assert.ok(needDatabase.includes('scripts/db/backup-restore.test.ts'), needDatabase.join('\n'));
        assert.deepStrictEqual(
            needDatabase.filter((file) => !ran.has(file)),
            [],
            `CI never gives these a database, so their database tests never run. Put them in scripts/db (or add a pattern to "${DATABASE_STEP}").`,
        );
    });

    test('runs every test in scripts/db, by a pattern rather than a list', () => {
        assert.ok(patterns().includes('scripts/db/*.test.ts'), patterns().join(' '));
    });

    test('every pattern matches a test, so a renamed file can\'t leave one running nothing', () => {
        for (const pattern of patterns()) {
            assert.ok(globSync(pattern).length > 0, `${pattern} matches no file`);
        }
    });

    test('gives them the database the job prepared', () => {
        assert.match(databaseStep().body, /^\s+SCRIPTS_TEST_DATABASE_URL: \$\{\{ env\.ADMIN_DATABASE_URL \}\}$/m);
    });

    test('installs pg_dump and pg_restore 17 first, which the backup test needs', () => {
        const names = e2eSteps().map((step) => step.name);
        assert.ok(names.includes(INSTALL_STEP), names.join('\n'));
        assert.ok(names.indexOf(INSTALL_STEP) < names.indexOf(DATABASE_STEP), names.join('\n'));
    });
});
