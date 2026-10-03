/**
 * POST /api/portfolio/import
 *
 * Imports parsed holdings rows (from the Holdings "Import CSV" dialog) into
 * an account the signed-in user owns, or a new account for them.
 *
 * Body:     { portfolioId?: uuid, newPortfolioName?: string, rows: ImportRow[] }
 * Response: { data: { portfolioId, createdPortfolio, insert, update, unchanged } }
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError, logApiEvent } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { ImportAccessError, importHoldings } from '@/lib/portfolio/importHoldings';
import { portfolioImportSchema } from '@/lib/validators/portfolio-import';

export const dynamic = 'force-dynamic';

/** ~1000 rows of JSON with generous names stays well under this. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return body.reason === 'too-large'
            ? apiError('Import is too large.', 'IMPORT_TOO_LARGE', 413)
            : apiError('Invalid import', 'INVALID_IMPORT', 400);
    }
    const parsed = portfolioImportSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid import', 'INVALID_IMPORT', 400);
    }

    try {
        const result = await importHoldings(auth.context.userId, parsed.data);
        logApiEvent('portfolio_csv_imported', {
            route: '/api/portfolio/import',
            rows: parsed.data.rows.length,
            inserted: result.insert,
            updated: result.update,
            createdPortfolio: result.createdPortfolio,
            userScoped: true,
        });
        return NextResponse.json({ data: result });
    } catch (err) {
        if (err instanceof ImportAccessError) {
            return apiError('Portfolio not found', 'PORTFOLIO_NOT_FOUND', 404);
        }
        return internalServerError(err, 'Unable to import holdings.', 'PORTFOLIO_IMPORT_FAILED');
    }
}
