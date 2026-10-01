import { expect, type Locator, type Page } from '@playwright/test';

function pathnameFromTarget(target: string): string {
    return new URL(target, 'http://localhost:3000').pathname;
}

export async function waitForAppHydration(page: Page, target = page.url()) {
    await expect(page.locator('body')).toHaveAttribute(
        'data-pm-hydrated-path',
        pathnameFromTarget(target),
        { timeout: 10_000 },
    );
}

export async function gotoAppPage(page: Page, target: string) {
    await page.goto(target);
    await waitForAppHydration(page, target);
}

export async function reloadAppPage(page: Page) {
    await page.reload();
    await waitForAppHydration(page);
}

export async function selectAppTab(page: Page, name: string | RegExp) {
    const tab = page.getByRole('tab', { name });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function clickUntil(
    locator: Locator,
    assertion: () => Promise<void>,
    timeout = 10_000,
) {
    await expect(async () => {
        await locator.click();
        await assertion();
    }).toPass({ timeout });
}

/**
 * Starts collecting browser console errors and uncaught page errors.
 * Call before navigation; read the returned array after the page settles.
 */
export function collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    return errors;
}

/**
 * On Today, the full risk-policy checks sit behind the policy strip and
 * only render when the user has holdings. Opens the strip and returns
 * true, or returns false when the book is empty (callers then skip).
 */
export async function openPolicyChecks(page: Page): Promise<boolean> {
    const hero = page.getByTestId('today-hero');
    await expect(hero).toBeVisible();
    if ((await hero.getAttribute('data-empty')) === 'true') return false;
    const strip = page.getByTestId('policy-strip');
    if ((await strip.getAttribute('open')) === null) await strip.locator('summary').click();
    await expect(page.getByTestId('risk-policy-dashboard')).toBeVisible();
    return true;
}
