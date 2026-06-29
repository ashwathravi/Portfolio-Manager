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
