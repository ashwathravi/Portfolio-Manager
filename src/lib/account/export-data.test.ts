import { test } from 'node:test';
import assert from 'node:assert/strict';

import { holdingsCsvRows, transactionsCsvRows, type AccountExport, type ExportedAccount } from './export-data';

const account = (name: string, fields: Partial<ExportedAccount> = {}): ExportedAccount => ({
    id: name, name, description: null, source: 'manual', cashBalance: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    holdings: [], transactions: [], valuationHistory: [], orderPlans: [], ...fields,
});
const exported = (accounts: ExportedAccount[]): AccountExport => ({
    format: 'atlas-wealth-export', version: 1, exportedAt: '2026-10-26T18:00:00.000Z', profile: { name: null, email: null }, settings: null,
    accounts, linkedConnections: [], watchlist: [], journal: [], theses: [], askHistory: [],
});
const trade = (date: string, symbol: string) => ({ date, type: 'BUY', symbol, quantity: 2, price: 10.5, amount: 21, fees: null, currency: 'USD', notes: null, source: 'csv' });

test('holdingsCsvRows - one row per holding, across accounts, with its cost basis', () => {
    const data = exported([
        account('Brokerage', { holdings: [{ symbol: 'AAPL', name: 'Apple', quantity: 3, avgCost: 100.333, lastPrice: 120, updatedAt: '' }] }),
        account('IRA', { holdings: [{ symbol: 'VTI', name: 'Vanguard', quantity: 1, avgCost: 250, lastPrice: null, updatedAt: '' }] }),
    ]);
    assert.deepEqual(holdingsCsvRows(data), [
        { account: 'Brokerage', symbol: 'AAPL', name: 'Apple', quantity: 3, avg_cost: 100.333, cost_basis: 301, last_price: 120 },
        { account: 'IRA', symbol: 'VTI', name: 'Vanguard', quantity: 1, avg_cost: 250, cost_basis: 250, last_price: '' },
    ]);
});

test('transactionsCsvRows - every account\'s transactions, oldest first, dates as days, blanks for none', () => {
    const data = exported([
        account('Brokerage', { transactions: [trade('2026-03-05T12:00:00.000Z', 'AAPL')] }),
        account('IRA', { transactions: [{ ...trade('2026-02-01T12:00:00.000Z', 'VTI'), type: 'DEPOSIT', symbol: null, quantity: null, price: null, amount: 500 }] }),
    ]);
    assert.deepEqual(transactionsCsvRows(data), [
        { account: 'IRA', date: '2026-02-01', type: 'DEPOSIT', symbol: '', quantity: '', price: '', amount: 500, fees: '', currency: 'USD', notes: '', source: 'csv' },
        { account: 'Brokerage', date: '2026-03-05', type: 'BUY', symbol: 'AAPL', quantity: 2, price: 10.5, amount: 21, fees: '', currency: 'USD', notes: '', source: 'csv' },
    ]);
    assert.deepEqual(transactionsCsvRows(exported([])), []);
});
