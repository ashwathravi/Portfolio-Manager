import { expect, type Page } from '@playwright/test';

/**
 * Closed trades for a user with no other history (launch item i51), made
 * through the APIs the app itself uses. In a new "Trading" account:
 *
 * - DIS: 10 bought on the Monday of the latest review week that has ended
 *   (Monday to Friday 4 pm, as the browser counts it: src/lib/reviews/weeks.ts)
 *   at $100 and sold that Wednesday at $90, a $100 loss. Its reason is an
 *   entry decision in Research › Journal the day before the buy.
 * - ABNB: 5 bought today (Eastern) at $100 and sold today at $110, a $50
 *   gain, opened by a buy drafted on Trade today with a calm mood and its
 *   rationale, then marked placed.
 */
export const DIS_REASON = 'Start a position — Parks reopening ahead of the holidays.';
export const ABNB_REASON = 'Travel demand holds up into winter.';

export interface SeededTrades {
    accountId: string;
    /** YYYY-MM-DD dates of DIS's buy and sale. */
    weekBuy: string;
    weekSell: string;
    /** The review week's id (`wk:<Monday>`). */
    weekId: string;
    /** Today, Eastern: ABNB's buy and sale. */
    today: string;
    /** Whether today's ABNB trade falls in that review week too. */
    todayInWeek: boolean;
}

export async function seedClosedTrades(page: Page): Promise<SeededTrades> {
    const dates = await page.evaluate(() => {
        const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const now = new Date();
        const day = now.getDay();
        const ended = day === 0 || day === 6 || (day === 5 && now.getHours() >= 16);
        const base = ended ? new Date(now) : new Date(now.getTime() - 7 * 86_400_000);
        const monday = new Date(base);
        monday.setDate(base.getDate() - (base.getDay() === 0 ? 6 : base.getDay() - 1));
        monday.setHours(0, 0, 0, 0);
        const wednesday = new Date(monday);
        wednesday.setDate(monday.getDate() + 2);
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
        return {
            weekBuy: iso(monday),
            weekSell: iso(wednesday),
            weekId: `wk:${iso(monday)}`,
            today,
            // Trades have dates, not times: a week counts them Monday to Friday by date.
            todayInWeek: today >= iso(monday) && today <= iso(friday),
            dayBefore: iso(new Date(monday.getTime() - 86_400_000)),
        };
    });

    const created = await page.request.post('/api/portfolios', { data: { name: 'Trading', cashBalance: 1000 } });
    expect(created.status()).toBe(201);
    const accountId: string = (await created.json()).data.id;

    const plan = await page.request.post('/api/orders', {
        data: {
            portfolioId: accountId,
            instrumentType: 'equity',
            ticker: 'ABNB',
            side: 'buy',
            type: 'limit',
            quantity: 5,
            limitPrice: 100,
            timeInForce: 'day',
            needsApproval: false,
            rationale: {
                thesisId: 'thesis-abnb',
                setupType: 'conviction_add',
                conviction: 7,
                mood: 'calm',
                rationale: ABNB_REASON,
                capturedAt: new Date().toISOString(),
                timeToDecisionMs: 42_000,
            },
        },
    });
    expect(plan.status()).toBe(201);
    const orderId: string = (await plan.json()).data.id;
    expect((await page.request.patch(`/api/orders/${orderId}`, { data: { status: 'placed' } })).status()).toBe(200);

    const entry = {
        id: 'c0ffee00-0000-4000-8000-0000000000d1', date: dates.dayBefore, type: 'entry', ticker: 'DIS',
        decision: 'Start a position', rationale: 'Parks reopening ahead of the holidays.', outcome: 'pending', thesisId: null, dismissed: false,
    };
    expect((await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry, order: { session: 'e2e-trades', seq: 1 } } })).status()).toBe(204);

    const trades = [
        { type: 'BUY', date: dates.weekBuy, symbol: 'DIS', quantity: 10, price: 100 },
        { type: 'SELL', date: dates.weekSell, symbol: 'DIS', quantity: 10, price: 90 },
        { type: 'BUY', date: dates.today, symbol: 'ABNB', quantity: 5, price: 100 },
        { type: 'SELL', date: dates.today, symbol: 'ABNB', quantity: 5, price: 110 },
    ];
    for (const transaction of trades) {
        expect((await page.request.post('/api/transactions', { data: { portfolioId: accountId, transaction } })).status()).toBe(201);
    }

    return {
        accountId,
        weekBuy: dates.weekBuy,
        weekSell: dates.weekSell,
        weekId: dates.weekId,
        today: dates.today,
        todayInWeek: dates.todayInWeek,
    };
}
