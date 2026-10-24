import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildMonthlySamples, getExampleMonthlySeries, monthEndDate } from './series';
import { computePeriodMetrics, computeRiskSnapshot } from './periodSummary';
import { maxDrawdown } from './calculations';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const samples = buildMonthlySamples(NOW);
const portfolio = samples.map((s) => ({ date: monthEndDate(s.year, s.month), value: s.account }));
const benchmark = samples.map((s) => ({ date: monthEndDate(s.year, s.month), value: s.benchmark }));

describe('example performance series', () => {
    test('ends at the last complete month and spans 25 points', () => {
        assert.strictEqual(samples.length, 25);
        assert.deepStrictEqual([samples.at(-1)?.year, samples.at(-1)?.month], [2026, 8]); // Sep 2026
        assert.deepStrictEqual([samples[0].year, samples[0].month], [2024, 8]);
    });

    test('January rolls back to December of the prior year', () => {
        const jan = buildMonthlySamples(Date.parse('2027-01-15T00:00:00Z'));
        assert.deepStrictEqual([jan.at(-1)?.year, jan.at(-1)?.month], [2026, 11]);
    });

    test('regression: a long-running process moves to the new month after it starts', () => {
        // The series used to be built once at module load, so a server that
        // loaded it on Sep 30 kept ending the curve at August after Oct 1 (UTC)
        // while the browser ended it at September, and /performance failed
        // hydration.
        const last = (series: { date: string }[]) => series.at(-1)?.date;
        const lateSep = getExampleMonthlySeries(Date.parse('2026-09-30T23:59:00Z'));
        const earlyOct = getExampleMonthlySeries(Date.parse('2026-10-01T00:01:00Z'));
        assert.strictEqual(last(lateSep.portfolio), '2026-08-31');
        assert.strictEqual(last(earlyOct.portfolio), '2026-09-30');
        assert.strictEqual(last(earlyOct.benchmark), '2026-09-30');
    });

    test('getExampleMonthlySeries returns the same series for every call within a UTC month', () => {
        const first = getExampleMonthlySeries(Date.parse('2026-10-01T00:00:00Z'));
        const last = getExampleMonthlySeries(Date.parse('2026-10-31T23:59:59Z'));
        assert.strictEqual(first, last);
        assert.deepStrictEqual(first.portfolio, portfolio);
        assert.deepStrictEqual(first.benchmark, benchmark);
    });

    test('points are dated at month ends', () => {
        assert.strictEqual(monthEndDate(2026, 1), '2026-02-28');
        assert.strictEqual(monthEndDate(2024, 1), '2024-02-29');
        assert.strictEqual(portfolio[0].date, '2024-09-30');
    });

    test('regression: risk metrics are plausible (was Sortino 35.66, max DD -1.04%)', () => {
        const risk = computeRiskSnapshot(portfolio, benchmark);
        assert.ok(risk.sortinoRatio > 0.5 && risk.sortinoRatio < 6, `sortino ${risk.sortinoRatio}`);
        const dd = maxDrawdown(portfolio.map((p) => p.value));
        assert.ok(dd < -0.05 && dd > -0.2, `max drawdown ${dd}`);
        const [oneYear] = computePeriodMetrics(portfolio, benchmark, ['1Y']);
        assert.ok(oneYear.sharpe !== null && oneYear.sharpe > 0.3 && oneYear.sharpe < 4, `sharpe ${oneYear.sharpe}`);
        assert.ok(oneYear.return > 0 && oneYear.return < 0.6, `1Y return ${oneYear.return}`);
    });
});
