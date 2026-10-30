import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    checkProduction,
    createGitHub,
    describeRun,
    syncIssue,
    type GitHub,
    type IssueContext,
    type Problem,
} from './production-check.mts';

// Launch item i71: the production monitor's checks and its issue.

const SITE = 'https://atlas.example.test';
const DUE = '2026-10-28T22:00:00.000Z';

type Reply = { status: number; body?: unknown } | Error;

/** A fetch that answers each URL from its own queue (the last reply repeats). */
function fakeFetch(replies: Record<string, Reply[]>) {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        assert.equal(init?.redirect, 'manual');
        const queue = replies[url.slice(SITE.length)];
        assert.ok(queue, `unexpected request to ${url}`);
        const reply = queue.length > 1 ? queue.shift()! : queue[0];
        if (reply instanceof Error) throw reply;
        return new Response(reply.body === undefined ? 'not json' : JSON.stringify(reply.body), { status: reply.status });
    }) as typeof fetch;
    return { fetchImpl, calls };
}

const ready = { status: 200, body: { status: 'ok', database: 'ok', checkedAt: DUE } };
const job = (name: string, status: 'ok' | 'late' | 'failed', lastSucceededAt: string | null = '2026-10-27T22:31:00.000Z') =>
    ({ job: name, status, lastSucceededAt, dueSince: DUE });
const jobsOk = { status: 200, body: { status: 'ok', database: 'ok', jobs: [job('prices', 'ok'), job('backup', 'ok')], checkedAt: DUE } };

async function check(replies: Record<string, Reply[]>) {
    const { fetchImpl, calls } = fakeFetch(replies);
    const sleeps: number[] = [];
    const problems = await checkProduction(`${SITE}/`, {
        fetch: fetchImpl,
        sleep: async (ms) => { sleeps.push(ms); },
        attempts: 3,
        retryDelayMs: 30_000,
    });
    return { problems, calls, sleeps };
}

describe('checkProduction', () => {
    test('nothing to report when the database answers and every job ran on time', async () => {
        const { problems, calls, sleeps } = await check({ '/api/health/ready': [ready], '/api/health/jobs': [jobsOk] });

        assert.deepEqual(problems, []);
        assert.deepEqual(calls, [`${SITE}/api/health/ready`, `${SITE}/api/health/jobs`]);
        assert.deepEqual(sleeps, []);
    });

    test('a blip is retried before it counts', async () => {
        const { problems, sleeps } = await check({
            '/api/health/ready': [new TypeError('fetch failed'), ready],
            '/api/health/jobs': [{ status: 503, body: { status: 'degraded', database: 'unavailable', jobs: [] } }, jobsOk],
        });

        assert.deepEqual(problems, []);
        assert.deepEqual(sleeps, [30_000, 30_000]);
    });

    test('the site is down when it never answers, and the jobs are not asked', async () => {
        const { problems, calls, sleeps } = await check({ '/api/health/ready': [new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') })] });

        assert.deepEqual(problems, [{ key: 'site', short: 'the site is down', message: `${SITE} didn't answer: fetch failed (getaddrinfo ENOTFOUND).` }]);
        assert.equal(calls.length, 3);
        assert.deepEqual(sleeps, [30_000, 30_000]);
    });

    test('a redirect or an error page is the site being down, with the status', async () => {
        for (const status of [307, 401, 500]) {
            const { problems } = await check({ '/api/health/ready': [{ status }] });
            assert.deepEqual(problems, [{ key: 'site', short: 'the site is down', message: `${SITE}/api/health/ready answered HTTP ${status}.` }]);
        }
    });

    test('a database the app can\'t reach, or doesn\'t have, is its own problem', async () => {
        const unavailable = await check({ '/api/health/ready': [{ status: 503, body: { status: 'degraded', database: 'unavailable' } }] });
        assert.deepEqual(unavailable.problems, [{ key: 'database', short: 'the database is unreachable', message: "The app is up but can't reach its database." }]);
        assert.equal(unavailable.calls.length, 3);

        const missing = await check({ '/api/health/ready': [{ status: 503, body: { status: 'degraded', database: 'not_configured' } }] });
        assert.equal(missing.problems[0].key, 'database');
        assert.match(missing.problems[0].message, /no usable DATABASE_URL/);
    });

    test('each late or failed job is a problem, read once', async () => {
        const { problems, calls } = await check({
            '/api/health/ready': [ready],
            '/api/health/jobs': [{
                status: 503,
                body: {
                    status: 'degraded',
                    database: 'ok',
                    jobs: [job('prices', 'failed'), job('plaid', 'ok'), job('snapshots', 'late'), job('backup', 'late', null)],
                    checkedAt: DUE,
                },
            }],
        });

        assert.equal(calls.length, 2);
        assert.deepEqual(problems, [
            { key: 'job:prices:failed', short: '"prices" failed', message: 'The nightly job "prices" failed on its last run (due after 2026-10-28 22:00 UTC).' },
            { key: 'job:snapshots:late', short: '"snapshots" is late', message: 'The nightly job "snapshots" hasn\'t succeeded since 2026-10-27 22:31 UTC (a run was due after 2026-10-28 22:00 UTC).' },
            { key: 'job:backup:late', short: 'the backup is late', message: 'The nightly backup has never succeeded (a run was due after 2026-10-28 22:00 UTC).' },
        ]);
    });

    test('a job check it can\'t read is a problem: missing, inconsistent, or with names it won\'t repeat', async () => {
        const cases: Array<[Reply, string]> = [
            [{ status: 404, body: { error: 'Not found' } }, 'answered HTTP 404'],
            [{ status: 503, body: { status: 'degraded', database: 'unavailable', jobs: [] } }, 'answered HTTP 503 (database: unavailable)'],
            [{ status: 200, body: { status: 'ok', database: 'ok', jobs: [job('prices', 'late')] } }, 'answered HTTP 200'],
            [{ status: 503, body: { status: 'degraded', database: 'ok', jobs: [job('::error::x', 'late')] } }, 'answered HTTP 503'],
            [{ status: 503, body: { status: 'degraded', database: 'ok', jobs: [{ ...job('prices', 'late'), dueSince: 'soon' }] } }, 'answered HTTP 503'],
            [new Error('socket hang up'), "didn't answer: socket hang up"],
        ];
        for (const [reply, what] of cases) {
            const { problems } = await check({ '/api/health/ready': [ready], '/api/health/jobs': [reply] });
            assert.deepEqual(problems, [{ key: 'jobs-endpoint', short: 'the job check failed', message: `${SITE}/api/health/jobs ${what}.` }], what);
        }
    });
});

// ---------------------------------------------------------------------------

interface FakeComment { body: string; user: { login: string } }
interface FakeIssue { number: number; body: string | null; title: string; state: string; user: { login: string }; pull_request?: unknown; comments: FakeComment[] }

const BOT = { login: 'github-actions[bot]' };

function fakeGitHub(issues: FakeIssue[] = []) {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const github: GitHub = {
        async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
            calls.push({ method, path, body });
            const reply = (value: unknown) => value as T;
            const list = /^\/repos\/o\/r\/issues\?state=open&per_page=100&page=(\d+)$/.exec(path);
            if (method === 'GET' && list) {
                const page = Number(list[1]);
                return reply(issues.filter((issue) => issue.state === 'open').slice((page - 1) * 100, page * 100));
            }
            const comments = /^\/repos\/o\/r\/issues\/(\d+)\/comments/.exec(path);
            const issue = issues.find((candidate) => candidate.number === Number(comments?.[1] ?? /issues\/(\d+)$/.exec(path)?.[1]));
            if (method === 'GET' && comments && issue) {
                const page = Number(/&page=(\d+)$/.exec(path)?.[1] ?? 1);
                return reply(issue.comments.slice((page - 1) * 100, page * 100));
            }
            if (method === 'POST' && comments && issue) {
                issue.comments.push({ body: (body as { body: string }).body, user: BOT });
                return reply({});
            }
            if (method === 'POST' && path === '/repos/o/r/issues') {
                const created = { number: 40 + issues.length, state: 'open', user: BOT, comments: [], ...(body as { title: string; body: string }) };
                issues.push(created);
                return reply(created);
            }
            if (method === 'PATCH' && issue) {
                Object.assign(issue, body);
                return reply(issue);
            }
            throw new Error(`unexpected ${method} ${path}`);
        },
    };
    return { github, calls, issues };
}

const context: IssueContext = {
    repo: 'o/r',
    mention: 'owner',
    siteUrl: SITE,
    runUrl: 'https://github.com/o/r/actions/runs/7',
    now: new Date('2026-10-29T01:07:00Z'),
};
const late: Problem = { key: 'job:prices:late', short: '"prices" is late', message: 'The nightly job "prices" hasn\'t succeeded since then.' };
const down: Problem = { key: 'site', short: 'the site is down', message: `${SITE} didn't answer.` };

describe('syncIssue', () => {
    test('nothing happens while every check passes and no issue is open', async () => {
        const { github, calls } = fakeGitHub();

        assert.deepEqual(await syncIssue([], github, context), { action: 'none' });
        assert.equal(calls.length, 1);
    });

    test('opens one issue that mentions the owner, says what fails and records it', async () => {
        const { github, issues } = fakeGitHub();

        assert.deepEqual(await syncIssue([late, down], github, context), { action: 'opened', number: 40 });

        assert.equal(issues[0].title, 'Production monitor: "prices" is late, the site is down');
        assert.equal(issues[0].body, [
            `@owner the production monitor found 2 problems with ${SITE}:`,
            '',
            `- ${late.message}`,
            `- ${down.message}`,
            '',
            'What each means and what to do: [docs/monitoring.md](https://github.com/o/r/blob/master/docs/monitoring.md). The monitor closes this issue once every check passes again.',
            '',
            'Checked 2026-10-29 01:07 UTC by [this run](https://github.com/o/r/actions/runs/7).',
            '',
            '<!-- production-monitor: job:prices:late site -->',
        ].join('\n'));
    });

    test('stays quiet while the same things fail', async () => {
        const { github, issues, calls } = fakeGitHub();
        await syncIssue([late, down], github, context);

        assert.deepEqual(await syncIssue([down, late], github, context), { action: 'unchanged', number: 40 });
        assert.equal(issues[0].comments.length, 0);
        assert.deepEqual(calls.filter((call) => call.method !== 'GET').length, 1);
    });

    test('comments and retitles when what fails changes, then compares with that comment', async () => {
        const { github, issues } = fakeGitHub();
        await syncIssue([late, down], github, context);

        assert.deepEqual(await syncIssue([late], github, context), { action: 'updated', number: 40 });
        assert.equal(issues[0].title, 'Production monitor: "prices" is late');
        assert.match(issues[0].comments[0].body, /^@owner what fails has changed:\n\n- The nightly job "prices"/);
        assert.match(issues[0].comments[0].body, /<!-- production-monitor: job:prices:late -->$/);

        assert.deepEqual(await syncIssue([late], github, context), { action: 'unchanged', number: 40 });
    });

    test('closes the issue once every check passes', async () => {
        const { github, issues } = fakeGitHub();
        await syncIssue([down], github, context);

        assert.deepEqual(await syncIssue([], github, context), { action: 'closed', number: 40 });
        assert.equal(issues[0].state, 'closed');
        assert.equal((issues[0] as unknown as { state_reason: string }).state_reason, 'completed');
        assert.equal(issues[0].comments[0].body, 'Every check passes again. Checked 2026-10-29 01:07 UTC by [this run](https://github.com/o/r/actions/runs/7).\n\n<!-- production-monitor:  -->');

        // The next failure opens a new issue.
        assert.deepEqual(await syncIssue([down], github, context), { action: 'opened', number: 41 });
    });

    test('ignores issues and pull requests that are not the monitor\'s, anyone\'s marker included', async () => {
        const { github, issues } = fakeGitHub([
            { number: 1, title: 'A bug', body: 'mentions production-monitor', state: 'open', user: BOT, comments: [] },
            { number: 2, title: 'Bump', body: '<!-- production-monitor: site -->', state: 'open', user: BOT, pull_request: {}, comments: [] },
            { number: 3, title: 'Copy', body: '<!-- production-monitor: site -->', state: 'open', user: { login: 'someone' }, comments: [] },
        ]);

        assert.deepEqual(await syncIssue([down], github, context), { action: 'opened', number: 43 });
        assert.equal(issues.length, 4);
        assert.equal(issues[2].state, 'open');
    });

    test('a marker someone else comments doesn\'t change what the monitor last said', async () => {
        const { github, issues } = fakeGitHub();
        await syncIssue([down], github, context);
        issues[0].comments.push({ body: '<!-- production-monitor: job:prices:late -->', user: { login: 'someone' } });

        assert.deepEqual(await syncIssue([down], github, context), { action: 'unchanged', number: 40 });
        assert.deepEqual(await syncIssue([late], github, context), { action: 'updated', number: 40 });
    });

    test('reads its latest state past the first page of comments', async () => {
        const { github, issues, calls } = fakeGitHub();
        await syncIssue([down], github, context);
        issues[0].comments.push(
            { body: '<!-- production-monitor: job:prices:late -->', user: BOT },
            ...Array.from({ length: 149 }, () => ({ body: 'Any news?', user: { login: 'someone' } })),
            { body: '<!-- production-monitor: site -->', user: BOT },
        );

        assert.deepEqual(await syncIssue([down], github, context), { action: 'unchanged', number: 40 });
        assert.deepEqual(calls.filter((call) => call.path.includes('/comments?')).slice(-2).map((call) => call.path.split('&page=')[1]), ['1', '2']);
    });

    test('finds its issue past the first page of open issues and pull requests', async () => {
        const others: FakeIssue[] = Array.from({ length: 150 }, (_, index) => ({
            number: 100 + index, title: 'Bump', body: null, state: 'open', user: { login: 'dependabot[bot]' }, pull_request: {}, comments: [],
        }));
        const { github, calls } = fakeGitHub([...others, { number: 7, title: 'Down', body: '<!-- production-monitor: site -->', state: 'open', user: BOT, comments: [] }]);

        assert.deepEqual(await syncIssue([down], github, context), { action: 'unchanged', number: 7 });
        assert.deepEqual(calls.filter((call) => call.path.includes('/issues?state=open')).map((call) => call.path.split('&page=')[1]), ['1', '2']);
    });

    test('without someone to mention, the issue still says what fails', async () => {
        const { github, issues } = fakeGitHub();
        await syncIssue([down], github, { ...context, mention: null, runUrl: null });

        assert.match(issues[0].body ?? '', /^The production monitor found a problem with/);
        assert.match(issues[0].body ?? '', /\nChecked 2026-10-29 01:07 UTC\.\n/);
    });
});

describe('createGitHub', () => {
    test('calls the REST API as the token and names a failed call without the token', async () => {
        const seen: Array<{ url: string; init?: RequestInit }> = [];
        const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
            seen.push({ url: String(url), init });
            return String(url).endsWith('/issues')
                ? new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 })
                : new Response(JSON.stringify([{ number: 1 }]), { status: 200 });
        }) as typeof fetch;
        const github = createGitHub('ghs_secret', fetchImpl);

        assert.deepEqual(await github.request('GET', '/repos/o/r/issues?state=open'), [{ number: 1 }]);
        const headers = seen[0].init?.headers as Record<string, string>;
        assert.equal(seen[0].url, 'https://api.github.com/repos/o/r/issues?state=open');
        assert.equal(headers.authorization, 'Bearer ghs_secret');
        assert.equal(headers['x-github-api-version'], '2022-11-28');

        await assert.rejects(github.request('POST', '/repos/o/r/issues', { title: 't' }), (error: Error) => {
            assert.match(error.message, /^GitHub POST \/repos\/o\/r\/issues answered HTTP 403: .*not accessible/);
            assert.doesNotMatch(error.message, /ghs_secret/);
            return true;
        });
        assert.equal(seen[1].init?.body, JSON.stringify({ title: 't' }));
    });
});

test('describeRun summarises the checks and the issue', () => {
    assert.equal(
        describeRun([], { action: 'closed', number: 40 }, SITE),
        `## Production monitor: ${SITE}\n\nEvery check passes: the database answers and every scheduled job ran on time.\n\nClosed issue #40.`,
    );
    assert.equal(describeRun([down], { action: 'unchanged', number: 40 }, SITE), `## Production monitor: ${SITE}\n\n- ${down.message}\n\nAlready open: issue #40.`);
    assert.equal(describeRun([], { action: 'none' }, SITE), `## Production monitor: ${SITE}\n\nEvery check passes: the database answers and every scheduled job ran on time.`);
});
