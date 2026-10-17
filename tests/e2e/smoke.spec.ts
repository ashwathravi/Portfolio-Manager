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

test.describe('Hydration across a UTC day boundary', () => {
    // Regression: example theses and journal dates came from each side's own
    // clock, so a page rendered just before UTC midnight and hydrated just
    // after it (or viewed with a browser clock on another day) failed
    // hydration. The browser now hydrates with the server's request time.
    for (const path of ['/research', '/strategies', '/execution', '/settings']) {
        test(`${path} hydrates when the browser is already on the next UTC day`, async ({ page }) => {
            await page.clock.install({ time: Date.now() + 86_400_000 });
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

test.describe('Market data without a provider key', () => {
    // E2E servers run with an empty POLYGON_API_KEY. Regression: the adapter
    // threw while being constructed, so every market-data route was a 500.
    // Not configured is now its own answer, and pages keep stored prices.
    // Quotes come from the price store, so with a database they answer from
    // it (the fixtures store closes only for IBM); without one they are not
    // configured.
    const notConfigured = { error: 'Market data is not configured.', code: 'MARKET_DATA_NOT_CONFIGURED' };
    const dbMode = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

    for (const path of [
        '/api/market-data/history?symbol=AAPL&range=1M',
        '/api/market-data/historical?symbol=AAPL&timeframe=1D',
        '/api/market-data/fundamentals?symbol=AAPL',
        '/api/market-data/search?query=apple',
    ]) {
        test(`${path.split('?')[0]} answers 503 MARKET_DATA_NOT_CONFIGURED`, async ({ page }) => {
            const response = await page.request.get(path);
            expect(response.status()).toBe(503);
            expect(await response.json()).toEqual(notConfigured);
        });
    }

    test('quotes answer from the price store, or 503 without a database', async ({ page }) => {
        const batch = await page.request.get('/api/market-data/quotes?symbols=AAPL,SPY');
        const single = await page.request.get('/api/market-data/quote?symbol=AAPL');
        if (dbMode) {
            expect(batch.status()).toBe(200);
            expect(await batch.json()).toEqual({ data: [] });
            expect(single.status()).toBe(404);
            expect(await single.json()).toEqual({ error: 'No price for AAPL yet.', code: 'QUOTE_UNAVAILABLE' });
        } else {
            for (const response of [batch, single]) {
                expect(response.status()).toBe(503);
                expect(await response.json()).toEqual(notConfigured);
            }
        }
    });

    test('portfolio valuation lists unpriced holdings instead of failing', async ({ page }) => {
        test.skip(!dbMode, 'requires the database-auth E2E mode');
        const response = await page.request.get('/api/portfolio/00000000-0000-4000-8000-000000000001/value');
        expect(response.status()).toBe(206);
        const { data } = await response.json();
        expect([...data.errors].sort()).toEqual(['AAPL', 'AMZN', 'GOOGL', 'MSFT', 'NVDA', 'TSLA']);
    });
});

test.describe('Scheduled jobs without CRON_SECRET', () => {
    // The proxy lets /api/cron/* through without a session and the route
    // checks the secret itself. E2E servers have no secret, so it must refuse
    // with 503, not ask for a session (401/redirect) and never run the jobs.
    test('/api/cron/daily fails closed, with or without a token or session', async ({ playwright, baseURL }) => {
        const notConfigured = { error: 'Scheduled jobs are not configured.', code: 'CRON_NOT_CONFIGURED' };
        const sessionless = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        try {
            const attempts: Array<Record<string, string>> = [{}, { authorization: 'Bearer guess' }];
            for (const headers of attempts) {
                const response = await sessionless.get('/api/cron/daily', { headers, maxRedirects: 0 });
                expect(response.status()).toBe(503);
                expect(await response.json()).toEqual(notConfigured);
            }
        } finally {
            await sessionless.dispose();
        }
    });
});
