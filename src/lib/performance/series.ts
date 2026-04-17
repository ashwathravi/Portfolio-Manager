import type { MonthlyValuation } from './periodSummary';

/**
 * Monthly equity curve used on the performance deep-dive page. Until a live
 * data source is wired up (AR-11/AR-12), this serves as the source of truth
 * for derived metrics so the numbers shown are internally consistent across
 * charts, Stat cards, and the period-breakdown table.
 */
const MONTHLY_SAMPLES: ReadonlyArray<{ year: number; month: number; account: number; benchmark: number; deployed: number }> = [
    { year: 2025, month: 0, account: 100000, benchmark: 100000, deployed: 55000 },
    { year: 2025, month: 1, account: 101850, benchmark: 101200, deployed: 58000 },
    { year: 2025, month: 2, account: 105270, benchmark: 102800, deployed: 62000 },
    { year: 2025, month: 3, account: 104170, benchmark: 102200, deployed: 60000 },
    { year: 2025, month: 4, account: 106950, benchmark: 103700, deployed: 67000 },
    { year: 2025, month: 5, account: 111100, benchmark: 106100, deployed: 72000 },
    { year: 2025, month: 6, account: 110420, benchmark: 105400, deployed: 68000 },
    { year: 2025, month: 7, account: 114320, benchmark: 107900, deployed: 74000 },
    { year: 2025, month: 8, account: 119530, benchmark: 110800, deployed: 80000 },
    { year: 2025, month: 9, account: 121160, benchmark: 111900, deployed: 78000 },
    { year: 2025, month: 10, account: 120240, benchmark: 111100, deployed: 82000 },
    { year: 2025, month: 11, account: 124720, benchmark: 113600, deployed: 88000 },
    { year: 2026, month: 0, account: 131060, benchmark: 117000, deployed: 92000 },
    { year: 2026, month: 1, account: 133560, benchmark: 118500, deployed: 96820 },
    { year: 2026, month: 2, account: 137410, benchmark: 120800, deployed: 99500 },
];

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(year: number, month: number) {
    return `${MONTH_LABEL[month]} ${String(year).slice(2)}`;
}

export const portfolioMonthlySeries: MonthlyValuation[] = MONTHLY_SAMPLES.map((s) => ({
    year: s.year,
    month: s.month,
    value: s.account,
}));

export const benchmarkMonthlySeries: MonthlyValuation[] = MONTHLY_SAMPLES.map((s) => ({
    year: s.year,
    month: s.month,
    value: s.benchmark,
}));

export const equityCurveData = MONTHLY_SAMPLES.map((s) => ({
    date: formatMonth(s.year, s.month),
    value: s.account,
}));

export const accountBalanceData = MONTHLY_SAMPLES.map((s) => ({
    date: formatMonth(s.year, s.month),
    account: s.account,
    deployed: s.deployed,
}));

export const monthlyPnLData = MONTHLY_SAMPLES.slice(1).map((s, i) => ({
    month: formatMonth(s.year, s.month),
    value: s.account - MONTHLY_SAMPLES[i].account,
}));
