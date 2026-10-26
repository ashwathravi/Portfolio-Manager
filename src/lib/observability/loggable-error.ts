/**
 * Errors in a form a server component can pass to console.* while it renders.
 *
 * In development React replays a render's console calls in the browser, and
 * the React in Next 16.4 can't revive an AggregateError there: its `errors`
 * come back null, `new AggregateError(null)` throws during the render, and the
 * page never finishes loading. postgres.js rejects with one when its host
 * resolves to several addresses (`localhost` is ::1 and 127.0.0.1) and none
 * of them answers.
 */

/**
 * An AggregateError as a plain Error that keeps its message, each inner
 * error's message, its code and its cause; anything else as it is.
 */
export function loggableError(error: unknown): unknown {
    if (!(error instanceof AggregateError)) return error;

    const inner: unknown[] = Array.isArray(error.errors) ? error.errors : [];
    const message = [error.message, ...inner.map((e) => (e instanceof Error ? e.message : String(e)))]
        .filter(Boolean)
        .join("; ");
    const plain = new Error(message || error.name, error.cause === undefined ? undefined : { cause: loggableError(error.cause) });
    plain.name = error.name;
    const { code } = error as { code?: unknown };
    if (code !== undefined) Object.assign(plain, { code });
    return plain;
}
