import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) smoke test.
 *
 * The Phase 3–8 redesign moved the page title out of the body and into
 * the Topbar (<h1 className="pm-topbar-title">), so the old
 * `h2:has-text("Good morning")` assertion is gone. We now assert on:
 *   1. Document title (unchanged)
 *   2. Topbar h1 with the dashboard title
 *   3. Sidebar brand block + primary nav visible
 */
test('homepage has title, topbar heading, and sidebar chrome', async ({ page }) => {
    await page.goto('/');

    // Document title.
    await expect(page).toHaveTitle(/Atlas Wealth|Portfolio Manager/);

    // Post-redesign page title lives in the Topbar, not the body.
    await expect(page.locator('h1.pm-topbar-title')).toHaveText('Today');

    // Sidebar chrome: aside + brand wordmark.
    await expect(page.locator('aside.pm-sidebar')).toBeVisible();
    await expect(page.locator('.pm-sidebar-title', { hasText: 'Atlas Wealth' })).toBeVisible();
});

test('regression: the app font is loaded (IBM Plex), not a silent system fallback', async ({ page }) => {
    await page.goto('/');
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toMatch(/IBM Plex Sans/i);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [...document.fonts].some((f) => /IBM Plex Sans/i.test(f.family) && f.status === 'loaded'));
    expect(loaded).toBe(true);
});

test('regression: fonts are self-hosted, with the Latin files preloaded and every subset available', async ({ page }) => {
    // next/font/google fetched the fonts from Google on every compile, and the
    // dev server showed a Build Error page whenever Google answered with URLs
    // Turbopack cannot parse. The files now ship from src/styles/fonts.
    const googleRequests: string[] = [];
    page.on('request', (request) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) googleRequests.push(request.url());
    });
    await page.goto('/');

    // Latin Plex Sans plus the three Latin Plex Mono weights, as before.
    const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll(
        (links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname),
    );
    expect(preloads).toHaveLength(4);
    for (const path of preloads) expect(path).toMatch(/^\/_next\/static\/media\/.+\.woff2$/);

    const faces = await page.evaluate(async () => {
        const load = async (font: string, text?: string) =>
            (await document.fonts.load(font, text)).map((face) => ({ family: face.family, status: face.status, unicodeRange: face.unicodeRange }));
        return {
            mono: await load('600 16px "IBM Plex Mono"', '0123456789'),
            // Δ labels the dashboard's period readouts; it comes from the Greek file.
            greek: await load('600 16px "IBM Plex Sans"', 'Δ'),
        };
    });
    expect(faces.mono.length).toBeGreaterThan(0);
    for (const face of faces.mono) expect(face).toMatchObject({ family: expect.stringMatching(/IBM Plex Mono/), status: 'loaded' });
    expect(faces.greek).toHaveLength(1);
    expect(faces.greek[0]).toMatchObject({ family: expect.stringMatching(/IBM Plex Sans/), status: 'loaded' });
    expect(faces.greek[0].unicodeRange).toMatch(/U\+370-377/i);

    const fontFiles = await page.evaluate(() => performance.getEntriesByType('resource')
        .map((entry) => new URL(entry.name))
        .filter((url) => url.pathname.endsWith('.woff2'))
        .map((url) => `${url.origin === location.origin ? '' : url.origin}${url.pathname}`));
    expect(fontFiles.length).toBeGreaterThan(0);
    for (const file of fontFiles) expect(file).toMatch(/^\/_next\/static\/media\//);
    expect(googleRequests).toEqual([]);
});

test.describe('Hydration across viewer timezones', () => {
    // Regression: dates and times formatted in the server's timezone made
    // Behaviour, Research, and Trade fail hydration for viewers elsewhere.
    test.use({ timezoneId: 'Asia/Tokyo' });

    for (const path of ['/', '/performance', '/performance/behaviour', '/research', '/research/thesis/NVDA', '/execution', '/strategies', '/portfolios/activity']) {
        test(`${path} hydrates without mismatches`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => { if (m.type() === 'error' && /Hydration|did not match/i.test(m.text())) errors.push(m.text()); });
            await page.goto(path);
            await page.waitForTimeout(1500);
            expect(errors.filter((e) => /Hydration|did not match/i.test(e))).toEqual([]);
        });
    }
});

test.describe('Phone layout', () => {
    // Regression: 11 routes scrolled sideways at 390px (the content column
    // grew to the top bar's min-content width).
    test.use({ viewport: { width: 390, height: 844 } });

    for (const path of ['/', '/portfolios/holdings', '/portfolios/accounts', '/portfolios/activity', '/portfolios/detail/NVDA', '/performance', '/performance/behaviour', '/research', '/research/thesis/NVDA', '/strategies', '/execution', '/ask', '/settings', '/help']) {
        test(`${path} has no horizontal overflow`, async ({ page }) => {
            await page.goto(path);
            await page.waitForTimeout(1200);
            const overflow = await page.evaluate(() => {
                const main = document.querySelector('main');
                return {
                    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    main: main ? main.scrollWidth - main.clientWidth : 0,
                };
            });
            expect(overflow.doc).toBeLessThanOrEqual(1);
            expect(overflow.main).toBeLessThanOrEqual(1);
        });
    }
});
