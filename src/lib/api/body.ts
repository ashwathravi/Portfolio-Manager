/**
 * Reads a JSON request body with a hard byte cap. Counts the bytes actually
 * streamed, so a chunked upload without Content-Length cannot slip past the
 * limit the way a header check alone would allow.
 */
export type JsonBodyResult =
    | { ok: true; value: unknown }
    | { ok: false; reason: 'too-large' | 'invalid-json' };

export type TextBodyResult =
    | { ok: true; text: string }
    | { ok: false; reason: 'too-large' | 'missing' };

/** The raw body as text, under the same cap: for a signature over its exact bytes. */
export async function readTextBody(request: Request, maxBytes: number): Promise<TextBodyResult> {
    const declared = Number(request.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too-large' };
    if (!request.body) return { ok: false, reason: 'missing' };
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, reason: 'too-large' };
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
    const body = await readTextBody(request, maxBytes);
    if (!body.ok) return { ok: false, reason: body.reason === 'too-large' ? 'too-large' : 'invalid-json' };
    try {
        return { ok: true, value: JSON.parse(body.text) };
    } catch {
        return { ok: false, reason: 'invalid-json' };
    }
}
