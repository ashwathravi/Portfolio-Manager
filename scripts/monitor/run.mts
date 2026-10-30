import { appendFileSync } from "node:fs";

import { checkProduction, createGitHub, describeRun, syncIssue } from "./production-check.mts";

/**
 * The production monitor's run (launch item i71; docs/monitoring.md), every
 * half hour from .github/workflows/production-monitor.yml:
 *
 *   PRODUCTION_URL=https://… GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/name \
 *     [MONITOR_MENTION=owner] node scripts/monitor/run.mts
 *
 * Plain Node, no install. What it finds goes to the monitor's issue and the
 * run's summary; the run fails only when it couldn't check or couldn't keep
 * the issue up to date, so an outage notifies once, through the issue, not
 * every half hour.
 */
async function main() {
    const siteUrl = process.env.PRODUCTION_URL?.trim();
    const token = process.env.GITHUB_TOKEN?.trim();
    const repo = process.env.GITHUB_REPOSITORY?.trim();
    if (!siteUrl || !token || !repo) {
        console.error("::error::The monitor needs PRODUCTION_URL (a repository variable), GITHUB_TOKEN and GITHUB_REPOSITORY.");
        process.exit(1);
    }
    const runId = process.env.GITHUB_RUN_ID?.trim();
    const runUrl = runId ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${runId}` : null;

    const problems = await checkProduction(siteUrl);
    for (const problem of problems) console.log(`::warning title=Production::${problem.message}`);

    const outcome = await syncIssue(problems, createGitHub(token), {
        repo,
        mention: process.env.MONITOR_MENTION?.trim() || null,
        siteUrl,
        runUrl,
        now: new Date(),
    });

    const summary = describeRun(problems, outcome, siteUrl);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

main().catch((error) => {
    console.error(`::error::The monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
