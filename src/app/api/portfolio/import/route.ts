/**
 * POST /api/portfolio/import
 *
 * Imports parsed holdings rows (from the Holdings "Import CSV" dialog) into
 * an account the signed-in user owns, or a new account for them, with the
 * file's option positions (launch item i63). Option rows for a contract a
 * linked account that still syncs brought in are left as the sync has them,
 * and counted in options.unchanged. The file's rows with no ticker Atlas
 * can price come in as holdings valued by hand (`manual`), as of
 * `valuesAsOf` (today in UTC when left out, at most tomorrow in UTC); a
 * linked account refuses them while it syncs, since its bank reports its
 * own.
 *
 * Body:     { portfolioId?: uuid, newPortfolioName?: string, rows: ImportRow[], options?: OptionContractRow[],
 *             manual?: { name, identifier?, quantity?, value, costBasis? }[], valuesAsOf?: 'YYYY-MM-DD' }
 *           or, for a file covering several accounts, { accounts: [that body, …] }, written
 *           together or not at all, as one of the day's imports
 * Response: { data: { portfolioId, createdPortfolio, insert, update, unchanged, options: { insert, update, unchanged },
 *             manual: { insert, update, unchanged, replacedPositions } } }
 *           or, for `accounts`, { data: { accounts: [that result, …] } } in the same order
 * Errors:   400 INVALID_IMPORT; 404 PORTFOLIO_NOT_FOUND; 409 DUPLICATE_ACCOUNT_NAME
 *           or ACCOUNT_LIMIT (a new account, checked as creating one), LINKED_ACCOUNT (holdings
 *           valued by hand into a linked account that still syncs; nothing is written) or
 *           MANUAL_HOLDING_LIMIT; 413 IMPORT_TOO_LARGE; 429 DAILY_QUOTA_REACHED (the day's CSV
 *           imports, shared with transactions)
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { consumeDailyQuota } from '@/lib/api/daily-quota';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requestIdFrom } from '@/lib/observability/request-id';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { RecordLimitError } from '@/lib/limits/records';
import { recordLimitResponse } from '@/lib/limits/records-server';
import { ImportAccessError, importHoldings, importHoldingsToAccounts, LinkedAccountImportError } from '@/lib/portfolio/importHoldings';
import { AccountLimitError, DuplicateAccountNameError, MAX_ACCOUNTS_PER_USER } from '@/lib/portfolio/manage';
import { loadQuotes } from '@/lib/services/market-data-service';
import { portfolioImportSchema, portfolioMultiImportSchema } from '@/lib/validators/portfolio-import';

export const dynamic = 'force-dynamic';

/** ~1000 rows of JSON (positions or holdings valued by hand) with generous names, over a few dozen accounts, stays well under this. */
const MAX_BODY_BYTES = 384 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Import is too large.', 'IMPORT_TOO_LARGE', 413)
            : apiError('Invalid import', 'INVALID_IMPORT', 400);
    }
    const multi = typeof body.value === 'object' && body.value !== null && 'accounts' in body.value;
    const parsed = multi
        ? portfolioMultiImportSchema.safeParse(body.value)
        : portfolioImportSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid import', 'INVALID_IMPORT', 400);
    }
    const groups = 'accounts' in parsed.data ? parsed.data.accounts : [parsed.data];
    const overQuota = await consumeDailyQuota(auth.context.userId, 'imports');
    if (overQuota) return overQuota;

    try {
        // The last stored prices, so imported positions show their worth at
        // once. Never throws: without market data they're valued at cost.
        const quotes = await loadQuotes([...new Set(groups.flatMap((g) => g.rows.map((r) => r.symbol)))]);
        const prices = Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [symbol, quote.price]));
        const results = multi
            ? await importHoldingsToAccounts(auth.context.userId, groups, prices)
            : [await importHoldings(auth.context.userId, groups[0], prices)];
        logApiEvent('portfolio_csv_imported', {
            route: '/api/portfolio/import',
            requestId: requestIdFrom(request.headers),
            accounts: groups.length,
            rows: groups.reduce((n, g) => n + g.rows.length, 0),
            optionRows: groups.reduce((n, g) => n + g.options.length, 0),
            inserted: results.reduce((n, r) => n + r.insert, 0),
            updated: results.reduce((n, r) => n + r.update, 0),
            // Counts only: what the holdings are called stays out of the log.
            manualRows: groups.reduce((n, g) => n + g.manual.length, 0),
            manualInserted: results.reduce((n, r) => n + r.manual.insert, 0),
            manualUpdated: results.reduce((n, r) => n + r.manual.update, 0),
            createdPortfolio: results.some((r) => r.createdPortfolio),
            userScoped: true,
        });
        return NextResponse.json({ data: multi ? { accounts: results } : results[0] });
    } catch (err) {
        if (err instanceof ImportAccessError) {
            return apiError('Portfolio not found', 'PORTFOLIO_NOT_FOUND', 404);
        }
        if (err instanceof DuplicateAccountNameError) {
            return apiError(`You already have an account named ${err.accountName}.`, 'DUPLICATE_ACCOUNT_NAME', 409);
        }
        if (err instanceof AccountLimitError) {
            return apiError(`You can have at most ${MAX_ACCOUNTS_PER_USER} accounts.`, 'ACCOUNT_LIMIT', 409);
        }
        if (err instanceof LinkedAccountImportError) return apiError(err.message, 'LINKED_ACCOUNT', 409);
        if (err instanceof RecordLimitError) return recordLimitResponse(err);
        return internalServerError(err, 'Unable to import holdings.', 'PORTFOLIO_IMPORT_FAILED');
    }
}
