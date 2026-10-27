import { expect, test, type Page } from '@playwright/test';

// Launch item i26: scripts run only with the nonce the proxy puts in each
// response's Content-Security-Policy (plus what those scripts load).

declare global {
    interface Window {
        __cspViolations?: string[];
        __injected?: boolean;
    }
}

async function recordViolations(page: Page) {
    await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
            window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
    });
}

function nonceOf(policy: string | undefined): string | undefined {
    return policy?.match(/'nonce-([^']+)'/)?.[1];
}

function scriptSources(policy: string): string[] {
    return policy.split('; ').find((part) => part.startsWith('script-src '))?.split(' ').slice(1) ?? [];
}

test.describe('Content Security Policy', () => {
    for (const path of ['/', '/portfolios/holdings', '/research', '/execution', '/strategies', '/performance', '/settings', '/privacy', '/terms']) {
        test(`${path} runs with a nonce and breaks no rule`, async ({ page }) => {
            await recordViolations(page);
            const response = await page.goto(path);
            const policy = response?.headers()['content-security-policy'] ?? '';

            expect(nonceOf(policy)).toBeTruthy();
            expect(scriptSources(policy)).toContain("'strict-dynamic'");
            expect(scriptSources(policy)).not.toContain("'unsafe-inline'");
            // The page's own scripts carry the nonce (the browser hides it
            // from getAttribute, but not from the property).
            const scriptNonces = await page.evaluate(() =>
                Array.from(document.querySelectorAll('script')).map((script) => script.nonce));
            expect(scriptNonces.length).toBeGreaterThan(0);
            expect(scriptNonces).toContain(nonceOf(policy));

            await page.waitForLoadState('networkidle');
            expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
        });
    }

    test('every response gets a new nonce', async ({ page }) => {
        const first = nonceOf((await page.goto('/settings'))?.headers()['content-security-policy']);
        const second = nonceOf((await page.goto('/settings'))?.headers()['content-security-policy']);

        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        expect(second).not.toBe(first);
    });

    test('regression: injected markup cannot run script', async ({ page }) => {
        await recordViolations(page);
        await page.goto('/research');

        await page.evaluate(() => {
            // What an XSS bug would let through: an inline handler, and an
            // inline script added the way a parser would add it.
            document.body.insertAdjacentHTML('beforeend', '<img src="/__csp-probe.png" onerror="window.__injected = true">');
            const frame = document.createElement('iframe');
            frame.srcdoc = '<script>parent.__injected = true</script>';
            document.body.appendChild(frame);
        });

        await expect.poll(() => page.evaluate(() => window.__cspViolations?.length ?? 0)).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.__injected)).toBeUndefined();
    });
});
