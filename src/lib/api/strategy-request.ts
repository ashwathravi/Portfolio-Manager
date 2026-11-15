import { readJsonBody } from '@/lib/api/body';
import { apiError } from '@/lib/api/security';
import { strategyInputSchema, type StrategyInput } from '@/lib/validators/strategy';

const MAX_BODY_BYTES = 32 * 1024;

/** The request's strategy, or the 400 (413 when too large) that names the first bad field. */
export async function parseStrategyBody(request: Request): Promise<{ ok: true; input: StrategyInput } | { ok: false; response: Response }> {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
        return { ok: false, response: apiError('Invalid strategy', 'INVALID_STRATEGY', body.reason === 'too-large' ? 413 : 400) };
    }
    const parsed = strategyInputSchema.safeParse(body.value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.length ? `${issue.path.join('.')}: ` : '';
        return { ok: false, response: apiError(`${field}${issue?.message ?? 'Invalid strategy'}`, 'INVALID_STRATEGY', 400) };
    }
    return { ok: true, input: parsed.data };
}
