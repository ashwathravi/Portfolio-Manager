/**
 * POST /api/transactions/import
 *
 * Imports a broker activity CSV's rows (parsed and previewed in the browser)
 * into one of the signed-in user's accounts (launch item i40). Rows the
 * account already has, by the file's own ID or by their contents, are
 * skipped, so importing a file again adds only what's new.
 *
 * Body:     { portfolioId, rows: Transaction[] }
 * Response: 200 { data: { inserted, duplicates } }; 400 INVALID_TRANSACTION_IMPORT;
 *           404 PORTFOLIO_NOT_FOUND; 413
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requestIdFrom } from '@/lib/observability/request-id';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { AccountNotFoundError, importTransactions } from '@/lib/portfolio/transactionsWrite';
import { transactionImportSchema } from '@/lib/validators/transaction';

export const dynamic = 'force-dynamic';

/** 2,000 rows with generous notes stays well under this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Import is too large.', 'TRANSACTION_IMPORT_TOO_LARGE', 413)
            : apiError('Invalid import', 'INVALID_TRANSACTION_IMPORT', 400);
    }
    const parsed = transactionImportSchema.safeParse(body.value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        // "rows.12.quantity" → "Row 13: …", so the user can find it.
        const row = issue?.path[0] === 'rows' && typeof issue.path[1] === 'number' ? `Row ${issue.path[1] + 1}: ` : '';
        return apiError(`${row}${issue?.message ?? 'Invalid import'}`, 'INVALID_TRANSACTION_IMPORT', 400);
    }

    try {
        const data = await importTransactions(auth.context.userId, parsed.data.portfolioId, parsed.data.rows);
        logApiEvent('transactions_csv_imported', {
            route: '/api/transactions/import',
            requestId: requestIdFrom(request.headers),
            rows: parsed.data.rows.length,
            inserted: data.inserted,
            duplicates: data.duplicates,
            userScoped: true,
        });
        return NextResponse.json({ data });
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        return internalServerError(err, 'Unable to import the transactions.', 'TRANSACTION_IMPORT_FAILED');
    }
}
