import type { FullConfig } from '@playwright/test';

const WAIT_MS = 180_000;
const INTERVAL_MS = 5_000;

/**
 * Waits until the site serves the commit the deploy job just deployed
 * (EXPECTED_RELEASE, which /api/health reports as `release`), so the suite
 * checks this deployment and not the one it replaced. Without
 * EXPECTED_RELEASE, a run by hand, it checks whatever is live.
 */
export default async function waitForRelease(config: FullConfig): Promise<void> {
    const expected = process.env.EXPECTED_RELEASE?.trim();
    if (!expected) return;
    const baseURL = config.projects[0]?.use.baseURL;
    if (!baseURL) throw new Error('playwright.production.config.ts has no baseURL.');

    const deadline = Date.now() + WAIT_MS;
    for (;;) {
        const seen = await healthOf(new URL('/api/health', baseURL));
        if (seen === `release ${expected}`) return;
        if (Date.now() >= deadline) {
            throw new Error(
                `${baseURL} reports ${seen}, not release ${expected}, after ${WAIT_MS / 60_000} minutes. `
                + 'Check which deployment has the production domain in Vercel › Deployments: '
                + 'after a rollback, new deploys don\'t take it until one is promoted (docs/deployment.md › Rolling back).',
            );
        }
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
}

/** What /api/health says about the release: "release <commit>", "no release", or why it didn't say. */
async function healthOf(url: URL): Promise<string> {
    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return `HTTP ${response.status}`;
        const body: unknown = await response.json();
        const release = (body as { release?: unknown } | null)?.release;
        return typeof release === 'string' ? `release ${release}` : 'no release';
    } catch (error) {
        return `no answer (${error instanceof Error ? error.message : String(error)})`;
    }
}
