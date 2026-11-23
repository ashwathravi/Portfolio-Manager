/**
 * Errors in a form that is safe to log or report, and that a server component
 * can pass to console.* while it renders.
 *
 * Drizzle wraps every error a query meets (a timeout, a lost connection, a
 * value Postgres refuses) in a DrizzleQueryError whose message ends with
 * "params:" and every parameter of the query: the names, values and notes a
 * user saved, or each holding of a positions file. The privacy policy says
 * error reports never include what the user typed (launch item i24), so
 * {@link withoutQueryParameters} replaces such an error with one that keeps
 * the SQL, which holds only placeholders, and what identifies the failure.
 *
 * In development React replays a render's console calls in the browser, and
 * the React in Next 16.4 can't revive an AggregateError there: its `errors`
 * come back null, `new AggregateError(null)` throws during the render, and the
 * page never finishes loading. postgres.js rejects with one when its host
 * resolves to several addresses (`localhost` is ::1 and 127.0.0.1) and none
 * of them answers.
 */

import { inspect, stripVTControlCharacters } from "node:util";

// How deep causes and an AggregateError's errors are followed.
const MAX_DEPTH = 8;
// An import's insert of many rows repeats its placeholders for each row.
const MAX_SQL_LENGTH = 2_000;
const FRAME_LINE = /^\s+at /;

/**
 * A failed query as Drizzle reported it, without its parameters: the SQL
 * (placeholders only), the driver's code (a SQLSTATE such as 57014 for a
 * statement timeout, or one such as ECONNRESET), and the constraint, table
 * and column Postgres names. Never the failing row: the cause's message,
 * detail and where can quote the values, so they're left out with it.
 */
export class DatabaseQueryError extends Error {
    declare readonly code?: string;
    declare readonly constraint?: string;
    declare readonly table?: string;
    declare readonly column?: string;

    constructor(query: string, cause: unknown) {
        const fields = identifyingFields(cause);
        const sql = query.length > MAX_SQL_LENGTH ? `${query.slice(0, MAX_SQL_LENGTH)}…` : query;
        const named = [
            fields.code && `code ${fields.code}`,
            fields.constraint && `constraint ${fields.constraint}`,
            fields.table && `table ${fields.table}`,
            fields.column && `column ${fields.column}`,
        ].filter(Boolean);
        const kind = named.length === 0 && cause instanceof Error && cause.name !== "Error" ? [cause.name] : [];
        const about = [...kind, ...named];
        super(`Failed query: ${sql}${about.length > 0 ? ` (${about.join(", ")})` : ""}`);
        // Only the fields there are, so a log line shows no empty ones.
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) Object.defineProperty(this, key, { value, enumerable: true });
        }
    }
}
// On the prototype, as Error's own is, so it isn't listed with the fields.
DatabaseQueryError.prototype.name = "DatabaseQueryError";

/**
 * `error` with every Drizzle query error in it, itself, a cause or one of an
 * AggregateError's errors, replaced by a {@link DatabaseQueryError}; the
 * same object when there is none.
 */
export function withoutQueryParameters(error: unknown, depth = 0): unknown {
    if (!(error instanceof Error) || depth > MAX_DEPTH) return error;
    if (isDrizzleQueryError(error)) return databaseQueryError(error);

    const hasCause = "cause" in error;
    const cause = hasCause ? withoutQueryParameters(error.cause, depth + 1) : undefined;
    const errors = error instanceof AggregateError && Array.isArray(error.errors) ? error.errors as unknown[] : undefined;
    const safeErrors = errors?.map((inner) => withoutQueryParameters(inner, depth + 1));
    const causeChanged = hasCause && cause !== error.cause;
    const errorsChanged = safeErrors !== undefined && safeErrors.some((inner, i) => inner !== errors?.[i]);
    if (!causeChanged && !errorsChanged) return error;

    // A copy that reads as the original does (its class, message, stack and
    // fields), with what it wraps made safe; the original is left alone.
    const copy = Object.create(Object.getPrototypeOf(error)) as Error;
    for (const key of Reflect.ownKeys(error)) {
        const descriptor = Object.getOwnPropertyDescriptor(error, key);
        if (!descriptor) continue;
        // V8's stack is an accessor that reads the original's own frames.
        const value = descriptor.get ? (error as unknown as Record<PropertyKey, unknown>)[key] : descriptor.value;
        Object.defineProperty(copy, key, { value, writable: true, configurable: true, enumerable: descriptor.enumerable ?? false });
    }
    if (causeChanged) Object.defineProperty(copy, "cause", { value: cause, writable: true, configurable: true, enumerable: false });
    if (errorsChanged) Object.defineProperty(copy, "errors", { value: safeErrors, writable: true, configurable: true, enumerable: false });
    return copy;
}

/** `error`'s message, or the error as text, without any query's parameters. */
export function safeErrorMessage(error: unknown): string {
    const safe = withoutQueryParameters(error);
    return safe instanceof Error ? safe.message : String(safe);
}

/**
 * An error to pass to console.*: without any query's parameters, and an
 * AggregateError as a plain Error that keeps its message, each inner error's
 * message, its code and its cause; anything else as it is.
 */
export function loggableError(error: unknown): unknown {
    const safe = withoutQueryParameters(error);
    if (!(safe instanceof AggregateError)) return safe;

    const inner: unknown[] = Array.isArray(safe.errors) ? safe.errors : [];
    const message = [safe.message, ...inner.map((e) => (e instanceof Error ? e.message : String(e)))]
        .filter(Boolean)
        .join("; ");
    const plain = new Error(message || safe.name, safe.cause === undefined ? undefined : { cause: loggableError(safe.cause) });
    plain.name = safe.name;
    const { code } = safe as { code?: unknown };
    if (code !== undefined) Object.assign(plain, { code });
    return plain;
}

/**
 * An error as plain data for a JSON log line, without any query's
 * parameters: its name, message and stack, the fields of its own a console
 * line shows that are text, numbers or true and false (a code, a
 * constraint), and its cause and an AggregateError's errors the same way.
 * Anything thrown that isn't an Error is given as text. JSON escapes
 * carriage returns and line feeds, so a message that quotes what a request
 * sent can't start a log line of its own.
 */
export function jsonLoggableError(error: unknown): unknown {
    return errorData(withoutQueryParameters(error), 0);
}

function errorData(error: unknown, depth: number): unknown {
    if (!(error instanceof Error)) return asText(error);

    const data: Record<string, unknown> = { name: asText(error.name), message: asText(error.message) };
    for (const [key, value] of Object.entries(error)) {
        if (Object.hasOwn(data, key)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") data[key] = value;
    }
    if (typeof error.stack === "string") data.stack = printedStack(error);
    if (depth < MAX_DEPTH) {
        if (error.cause !== undefined) data.cause = errorData(error.cause, depth + 1);
        if (error instanceof AggregateError && Array.isArray(error.errors)) {
            data.errors = (error.errors as unknown[]).map((inner) => errorData(inner, depth + 1));
        }
    }
    return data;
}

/**
 * The stack as console.* prints it. Next.js maps a stack's frames to the
 * source only when it prints the error (util.inspect), where it also writes
 * the first line from the error's name and message; `error.stack` names the
 * bundled chunks. The error printed carries only that name, message and
 * stack, so none of the original's other fields are printed, and the colour
 * codes Next adds when the output is a terminal are taken out.
 */
function printedStack(error: Error): string {
    const bare = new Error(asText(error.message));
    Object.defineProperty(bare, "name", { value: asText(error.name), configurable: true, writable: true });
    bare.stack = error.stack;
    return stripVTControlCharacters(inspect(bare));
}

function asText(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return String(value);
    } catch {
        // An object without a prototype has no toString.
        return Object.prototype.toString.call(value);
    }
}

interface DrizzleQueryErrorLike extends Error {
    query: string;
    params: unknown;
}

/** Drizzle's DrizzleQueryError, and anything else shaped like it. */
function isDrizzleQueryError(error: Error): error is DrizzleQueryErrorLike {
    return typeof (error as { query?: unknown }).query === "string" && "params" in error;
}

function databaseQueryError(error: DrizzleQueryErrorLike): DatabaseQueryError {
    const safe = new DatabaseQueryError(error.query, error.cause);
    // The original's frames, so the report still points at the query. V8
    // starts its stack with the message, parameters and all, so only what
    // follows the message is read.
    const stack = typeof error.stack === "string" ? error.stack : "";
    const at = error.message ? stack.indexOf(error.message) : -1;
    const frames = at < 0 ? [] : stack.slice(at + error.message.length).split("\n").filter((line) => FRAME_LINE.test(line));
    safe.stack = [`${safe.name}: ${safe.message}`, ...frames].join("\n");
    return safe;
}

function identifyingFields(cause: unknown): { code?: string; constraint?: string; table?: string; column?: string } {
    if (cause === null || typeof cause !== "object") return {};
    // postgres.js's PostgresError and its connection errors.
    const fields = cause as { code?: unknown; constraint_name?: unknown; table_name?: unknown; column_name?: unknown };
    const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
    return {
        code: text(fields.code),
        constraint: text(fields.constraint_name),
        table: text(fields.table_name),
        column: text(fields.column_name),
    };
}
