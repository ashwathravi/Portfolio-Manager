/**
 * The production monitor (launch item i71; runbook: docs/monitoring.md).
 * .github/workflows/production-monitor.yml runs scripts/monitor/run.mts every
 * half hour with plain Node and no install, so this file uses only Node's
 * built-ins and TypeScript that Node can strip.
 *
 * It asks production two things through its public health endpoints: can the
 * app reach its database (/api/health/ready), and has every scheduled job,
 * the nightly backup included, succeeded on schedule (/api/health/jobs).
 * Then it keeps one GitHub issue in step with the answer: opened, mentioning
 * the repository's owner, when something fails; commented on when what fails
 * changes; closed once every check passes.
 */

export interface Problem {
    /** Stable across runs while the same thing is wrong. */
    key: string;
    /** A few words, for the issue's title. */
    short: string;
    /** One sentence, for the issue's body. */
    message: string;
}

export interface CheckOptions {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** Tries per endpoint before an answer that isn't healthy counts. */
    attempts?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
}

type Body = Record<string, unknown>;
type Answer = { reached: true; status: number; body: Body | null } | { reached: false; error: string };

const JOB_NAME = /^[a-z][a-z0-9-]{0,40}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Everything wrong with production right now; empty when every check passes. */
export async function checkProduction(siteUrl: string, options: CheckOptions = {}): Promise<Problem[]> {
    const base = siteUrl.replace(/\/+$/, "");

    const ready = await askUntil(`${base}/api/health/ready`, options, (answer) => isHealthy(answer, (body) => body.status === "ok"));
    if (!ready.reached) {
        return [{ key: "site", short: "the site is down", message: `${base} didn't answer: ${ready.error}.` }];
    }
    const database = ready.status === 503 ? ready.body?.database : undefined;
    if (database === "unavailable") {
        return [{ key: "database", short: "the database is unreachable", message: "The app is up but can't reach its database." }];
    }
    if (database === "not_configured") {
        return [{ key: "database", short: "no database configured", message: "The app is up but has no usable DATABASE_URL." }];
    }
    if (!isHealthy(ready, (body) => body.status === "ok")) {
        return [{ key: "site", short: "the site is down", message: `${base}/api/health/ready answered HTTP ${ready.status}.` }];
    }

    // A late or failed job is a settled answer; only an unreadable one is retried.
    const jobs = await askUntil(`${base}/api/health/jobs`, options, (answer) => readJobs(answer) !== null);
    const report = readJobs(jobs);
    if (!report) {
        const databaseNote = jobs.reached && typeof jobs.body?.database === "string" && jobs.body.database !== "ok" ? ` (database: ${jobs.body.database})` : "";
        const what = jobs.reached ? `answered HTTP ${jobs.status}${databaseNote}` : `didn't answer: ${jobs.error}`;
        return [{ key: "jobs-endpoint", short: "the job check failed", message: `${base}/api/health/jobs ${what}.` }];
    }
    return report.filter((job) => job.status !== "ok").map(jobProblem);
}

interface JobReport {
    job: string;
    status: "ok" | "late" | "failed";
    lastSucceededAt: string | null;
    dueSince: string;
}

/** The jobs in a well-formed answer from a reachable database, or null. */
function readJobs(answer: Answer): JobReport[] | null {
    if (!answer.reached || ![200, 503].includes(answer.status) || answer.body?.database !== "ok") return null;
    const jobs = answer.body.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    const valid = jobs.every((job: unknown) => {
        if (!isRecord(job)) return false;
        return typeof job.job === "string" && JOB_NAME.test(job.job)
            && (job.status === "ok" || job.status === "late" || job.status === "failed")
            && (job.lastSucceededAt === null || (typeof job.lastSucceededAt === "string" && ISO_TIME.test(job.lastSucceededAt)))
            && typeof job.dueSince === "string" && ISO_TIME.test(job.dueSince);
    });
    if (!valid) return null;
    const report = jobs as JobReport[];
    // 200 means every job is ok, and 503 that one isn't.
    const allOk = report.every((job) => job.status === "ok");
    return (answer.status === 200) === allOk ? report : null;
}

function jobProblem(job: JobReport): Problem {
    const backup = job.job === "backup";
    const what = backup ? "The nightly backup" : `The nightly job "${job.job}"`;
    const name = backup ? "the backup" : `"${job.job}"`;
    if (job.status === "failed") {
        return {
            key: `job:${job.job}:failed`,
            short: `${name} failed`,
            message: `${what} failed on its last run (due after ${formatTime(job.dueSince)}).`,
        };
    }
    const since = job.lastSucceededAt ? `hasn't succeeded since ${formatTime(job.lastSucceededAt)}` : "has never succeeded";
    return {
        key: `job:${job.job}:late`,
        short: `${name} is late`,
        message: `${what} ${since} (a run was due after ${formatTime(job.dueSince)}).`,
    };
}

async function askUntil(url: string, options: CheckOptions, settled: (answer: Answer) => boolean): Promise<Answer> {
    const { attempts = 3, retryDelayMs = 30_000, sleep = defaultSleep } = options;
    let answer = await ask(url, options);
    for (let attempt = 1; attempt < attempts && !settled(answer); attempt += 1) {
        await sleep(retryDelayMs);
        answer = await ask(url, options);
    }
    return answer;
}

async function ask(url: string, { fetch: fetchImpl = fetch, timeoutMs = 20_000 }: CheckOptions): Promise<Answer> {
    try {
        const response = await fetchImpl(url, {
            headers: { accept: "application/json", "user-agent": "atlas-wealth-production-monitor" },
            // A redirect means the endpoint isn't public (a login or deployment protection).
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
        });
        let body: Body | null = null;
        try {
            const parsed: unknown = await response.json();
            body = isRecord(parsed) ? parsed : null;
        } catch {
            body = null;
        }
        return { reached: true, status: response.status, body };
    } catch (error) {
        return { reached: false, error: describeError(error) };
    }
}

function isHealthy(answer: Answer, bodyOk: (body: Body) => boolean): boolean {
    return answer.reached && answer.status === 200 && answer.body !== null && bodyOk(answer.body);
}

// ---------------------------------------------------------------------------
// The issue
// ---------------------------------------------------------------------------

export const ISSUE_MARKER = "production-monitor";

export interface GitHub {
    request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T>;
}

/** The REST API as the workflow's token. Errors name the call, never the token. */
export function createGitHub(token: string, fetchImpl: typeof fetch = fetch, apiUrl = "https://api.github.com"): GitHub {
    return {
        async request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
            const response = await fetchImpl(`${apiUrl}${path}`, {
                method,
                headers: {
                    accept: "application/vnd.github+json",
                    authorization: `Bearer ${token}`,
                    "x-github-api-version": "2022-11-28",
                    "user-agent": "atlas-wealth-production-monitor",
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => "");
                throw new Error(`GitHub ${method} ${path.split("?")[0]} answered HTTP ${response.status}: ${detail.slice(0, 200)}`);
            }
            return (await response.json()) as T;
        },
    };
}

export interface IssueContext {
    /** owner/name */
    repo: string;
    /** Who to mention when something breaks (the repository's owner). */
    mention: string | null;
    siteUrl: string;
    runUrl: string | null;
    now: Date;
}

export type IssueOutcome =
    | { action: "none" }
    | { action: "opened" | "updated" | "unchanged" | "closed"; number: number };

/** The login of issues and comments made with the workflow's token. */
export const MONITOR_LOGIN = "github-actions[bot]";

interface Issue {
    number: number;
    body: string | null;
    user: { login: string } | null;
    pull_request?: unknown;
}

interface Comment {
    body: string | null;
    user: { login: string } | null;
}

/**
 * Opens, updates or closes the monitor's issue so it says what `problems`
 * says. Only issues and comments the workflow's token wrote count: anyone can
 * write the marker in a public repository.
 */
export async function syncIssue(problems: readonly Problem[], github: GitHub, context: IssueContext): Promise<IssueOutcome> {
    const { repo } = context;
    const issue = await findMonitorIssue(github, repo);

    if (!issue) {
        if (problems.length === 0) return { action: "none" };
        const created = await github.request<Issue>("POST", `/repos/${repo}/issues`, {
            title: issueTitle(problems),
            body: [
                `${context.mention ? `@${context.mention} the` : "The"} production monitor found ${problems.length === 1 ? "a problem" : `${problems.length} problems`} with ${context.siteUrl}:`,
                "",
                ...problems.map((problem) => `- ${problem.message}`),
                "",
                `What each means and what to do: [docs/monitoring.md](https://github.com/${repo}/blob/master/docs/monitoring.md). The monitor closes this issue once every check passes again.`,
                "",
                checkedLine(context),
                "",
                stateMarker(problems),
            ].join("\n"),
        });
        return { action: "opened", number: created.number };
    }

    const comments = await github.request<Comment[]>("GET", `/repos/${repo}/issues/${issue.number}/comments?per_page=100`);
    const latest = [...comments].reverse()
        .filter((comment) => comment.user?.login === MONITOR_LOGIN)
        .map((comment) => readState(comment.body))
        .find((state) => state !== null);
    const previous = latest ?? readState(issue.body);

    if (problems.length === 0) {
        await github.request("POST", `/repos/${repo}/issues/${issue.number}/comments`, {
            body: [`Every check passes again. ${checkedLine(context)}`, "", stateMarker([])].join("\n"),
        });
        await github.request("PATCH", `/repos/${repo}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
        return { action: "closed", number: issue.number };
    }

    if (previous === stateKeys(problems)) return { action: "unchanged", number: issue.number };

    await github.request("POST", `/repos/${repo}/issues/${issue.number}/comments`, {
        body: [
            `${context.mention ? `@${context.mention} what` : "What"} fails has changed:`,
            "",
            ...problems.map((problem) => `- ${problem.message}`),
            "",
            checkedLine(context),
            "",
            stateMarker(problems),
        ].join("\n"),
    });
    await github.request("PATCH", `/repos/${repo}/issues/${issue.number}`, { title: issueTitle(problems) });
    return { action: "updated", number: issue.number };
}

/** The open issue the monitor opened, if any. The issues list includes pull requests. */
async function findMonitorIssue(github: GitHub, repo: string): Promise<Issue | undefined> {
    for (let page = 1; page <= 10; page += 1) {
        const open = await github.request<Issue[]>("GET", `/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
        const issue = open.find((candidate) => !candidate.pull_request
            && candidate.user?.login === MONITOR_LOGIN
            && readState(candidate.body) !== null);
        if (issue || open.length < 100) return issue;
    }
    return undefined;
}

function issueTitle(problems: readonly Problem[]): string {
    const title = `Production monitor: ${problems.map((problem) => problem.short).join(", ")}`;
    return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

function checkedLine({ now, runUrl }: IssueContext): string {
    return `Checked ${formatTime(now.toISOString())}${runUrl ? ` by [this run](${runUrl})` : ""}.`;
}

function stateKeys(problems: readonly Problem[]): string {
    return problems.map((problem) => problem.key).sort().join(" ");
}

function stateMarker(problems: readonly Problem[]): string {
    return `<!-- ${ISSUE_MARKER}: ${stateKeys(problems)} -->`;
}

/** The problem keys a monitor body records, or null if it isn't the monitor's. */
function readState(body: string | null): string | null {
    const match = new RegExp(`<!-- ${ISSUE_MARKER}: ?([^>]*?) ?-->`).exec(body ?? "");
    return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// The run's summary
// ---------------------------------------------------------------------------

/** Markdown for the workflow run's summary page. */
export function describeRun(problems: readonly Problem[], outcome: IssueOutcome, siteUrl: string): string {
    const lines = [`## Production monitor: ${siteUrl}`, ""];
    if (problems.length === 0) {
        lines.push("Every check passes: the database answers and every scheduled job ran on time.");
    } else {
        lines.push(...problems.map((problem) => `- ${problem.message}`));
    }
    if (outcome.action !== "none") {
        const verb = { opened: "Opened", updated: "Updated", unchanged: "Already open:", closed: "Closed" }[outcome.action];
        lines.push("", `${verb} issue #${outcome.number}.`);
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function isRecord(value: unknown): value is Body {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
        return `${error.name === "TimeoutError" ? "timed out" : error.message}${cause}`;
    }
    return String(error);
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
