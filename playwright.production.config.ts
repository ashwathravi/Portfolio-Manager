import { defineConfig, devices } from '@playwright/test';

// The post-deploy smoke test (launch item i72; docs/deployment.md). The deploy
// job runs it against the live site after every production deploy:
//
//   PRODUCTION_URL=https://atlas-wealth-lovat.vercel.app npm run test:production
//
// with EXPECTED_RELEASE set to the commit, so it first waits until the site
// serves that commit. No web server: it only reads the site, signed out.
const productionUrl = process.env.PRODUCTION_URL?.trim();
if (!productionUrl) {
    throw new Error('Set PRODUCTION_URL to the site to check, such as https://atlas-wealth-lovat.vercel.app.');
}

export default defineConfig({
    testDir: './tests/production',
    globalSetup: './tests/production/wait-for-release.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // A network blip shouldn't fail a deploy; a real fault fails every try.
    retries: 2,
    workers: 2,
    reporter: process.env.CI
        ? [['github'], ['html', { outputFolder: 'playwright-report-production', open: 'never' }]]
        : 'list',
    outputDir: 'test-results/production',
    use: {
        baseURL: productionUrl,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'production',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
