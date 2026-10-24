import type { Page } from '@playwright/test';

// With a database, the watchlist, journal and theses live in the account
// (launch item i38), and changes wait until a page has loaded them.
const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

/**
 * Resolves once the page has loaded `collection` from the account; at once
 * when research data is kept in the browser. Start it before navigating.
 */
export async function researchLoaded(page: Page, collection: 'watchlist' | 'journal' | 'theses'): Promise<void> {
    if (!databaseAuthEnabled) return;
    await page.waitForResponse((response) => response.url().endsWith(`/api/research/${collection}`) && response.ok());
}
