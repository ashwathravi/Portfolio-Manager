import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

import { DrizzleQueryError } from "drizzle-orm";

import { DatabaseQueryError, loggableError, safeErrorMessage, withoutQueryParameters } from "./loggable-error";

/** What postgres.js rejects with when neither of localhost's addresses answers. */
function refusedOnBothAddresses() {
    const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), {
        code: "ECONNREFUSED",
        address,
        port: 5432,
    });
    return Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
}

describe("loggableError", () => {
    test("turns an AggregateError into a plain Error React can replay", () => {
        const result = loggableError(refusedOnBothAddresses());

        assert.ok(result instanceof Error);
        assert.ok(!(result instanceof AggregateError));
        assert.ok(!("errors" in result));
        assert.equal(result.name, "AggregateError");
        assert.equal(result.message, "connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432");
        assert.equal((result as { code?: unknown }).code, "ECONNREFUSED");
    });

    test("keeps the AggregateError's own message before its inner ones", () => {
        const result = loggableError(new AggregateError([new Error("first"), "second"], "All attempts failed"));

        assert.equal((result as Error).message, "All attempts failed; first; second");
    });

    test("names the error when it has no message at all", () => {
        const result = loggableError(new AggregateError([], ""));

        assert.equal((result as Error).message, "AggregateError");
        assert.ok(!("code" in (result as Error)));
    });

    test("keeps the cause, an AggregateError cause made plain too", () => {
        const cause = refusedOnBothAddresses();
        const result = loggableError(new AggregateError([], "Transaction failed", { cause })) as Error;

        assert.ok(result.cause instanceof Error);
        assert.ok(!(result.cause instanceof AggregateError));
        assert.match((result.cause as Error).message, /ECONNREFUSED ::1:5432/);
    });

    test("leaves anything else as it is", () => {
        const plain = new Error("Failed query: select 1", { cause: refusedOnBothAddresses() });

        assert.equal(loggableError(plain), plain);
        assert.equal(loggableError("timeout"), "timeout");
        assert.equal(loggableError(null), null);
    });

    test("logs a failed query without its parameters", () => {
        const result = loggableError(failedInsert());

        assert.ok(result instanceof DatabaseQueryError);
        assert.ok(!inspect(result).includes(MARKER));
    });
});

const MARKER = "Sample-private-note-7319";
const INSERT = 'insert into "net_worth_items" ("id", "user_id", "name", "value", "note") values (default, $1, $2, $3, $4) returning "id"';
const FRAME = /^\s+at /;

/** Postgres's refusal as postgres.js gives it: a SQLSTATE, and a detail that quotes the row. */
function postgresRefusal(code: string, fields: Record<string, string> = {}) {
    return Object.assign(new Error(`invalid input syntax: "${MARKER}"`), {
        name: "PostgresError",
        code,
        detail: `Failing row contains (u-1, Sample home, 1234.56, ${MARKER}).`,
        where: `unnamed portal parameter $4 = '${MARKER}'`,
        ...fields,
    });
}

/** What Drizzle rejects with when an insert of made-up data fails. */
function failedInsert(cause: unknown = postgresRefusal("57014")) {
    return new DrizzleQueryError(INSERT, ["u-1", "Sample home", "1234.56", MARKER], cause as Error);
}

function framesOf(stack: string | undefined): string[] {
    return String(stack).split("\n").filter((line) => FRAME.test(line));
}

describe("withoutQueryParameters", () => {
    test("a failed query keeps its SQL and code, never its parameters or the row Postgres quotes", () => {
        const original = failedInsert();
        assert.ok(original.message.includes(MARKER), "Drizzle puts the parameters in the message");

        const safe = withoutQueryParameters(original);

        assert.ok(safe instanceof DatabaseQueryError);
        assert.equal(safe.name, "DatabaseQueryError");
        assert.equal(safe.message, `Failed query: ${INSERT} (code 57014)`);
        assert.equal(safe.code, "57014");
        assert.equal(safe.cause, undefined);
        assert.ok(!("params" in safe));
        // Everything console.error would print, the stack included.
        assert.ok(!inspect(safe, { showHidden: true, depth: 8 }).includes(MARKER));
        assert.ok(!String(safe.stack).includes(MARKER));
    });

    test("keeps the original's stack frames, so a report still points at the query", () => {
        const original = failedInsert();
        const safe = withoutQueryParameters(original) as Error;

        assert.ok(framesOf(original.stack).length > 0);
        assert.deepEqual(framesOf(safe.stack), framesOf(original.stack));
        assert.ok(String(safe.stack).startsWith(`DatabaseQueryError: Failed query: ${INSERT}`));
    });

    test("a parameter that reads like a stack frame stays out of the stack", () => {
        const original = new DrizzleQueryError(INSERT, ["u-1", `note\n    at ${MARKER} (forged.ts:1:1)`], postgresRefusal("22021"));

        assert.ok(!String((withoutQueryParameters(original) as Error).stack).includes(MARKER));
    });

    test("names the constraint, table and column Postgres reports", () => {
        const safe = withoutQueryParameters(failedInsert(postgresRefusal("23505", {
            constraint_name: "net_worth_items_pkey",
            table_name: "net_worth_items",
            column_name: "id",
        }))) as DatabaseQueryError;

        assert.equal(safe.message, `Failed query: ${INSERT} (code 23505, constraint net_worth_items_pkey, table net_worth_items, column id)`);
        assert.deepEqual({ ...safe }, { code: "23505", constraint: "net_worth_items_pkey", table: "net_worth_items", column: "id" });
    });

    test("a cause without a code is named by its kind, and one with neither adds nothing", () => {
        assert.equal(
            (withoutQueryParameters(failedInsert(new TypeError(`cannot serialize ${MARKER}`))) as Error).message,
            `Failed query: ${INSERT} (TypeError)`,
        );
        assert.equal((withoutQueryParameters(failedInsert(new Error(MARKER))) as Error).message, `Failed query: ${INSERT}`);
        const withoutCause = new DrizzleQueryError(INSERT, [MARKER], undefined as unknown as Error);
        assert.equal((withoutQueryParameters(withoutCause) as Error).message, `Failed query: ${INSERT}`);
    });

    test("cuts a very long query, such as an import's insert of many rows", () => {
        const rows = Array.from({ length: 1_000 }, (_, i) => `(default, $${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
        const query = `insert into "manual_holdings" ("id", "name", "value") values ${rows}`;
        const safe = withoutQueryParameters(new DrizzleQueryError(query, [MARKER], postgresRefusal("57014"))) as Error;

        assert.ok(safe.message.length < 2_100);
        assert.ok(safe.message.startsWith('Failed query: insert into "manual_holdings"'));
        assert.ok(safe.message.endsWith("… (code 57014)"));
    });

    test("a failed query in a cause or an AggregateError is replaced in a copy; the original is left alone", () => {
        const failed = failedInsert();
        const wrapped = Object.assign(new Error("Import failed", { cause: failed }), { code: "IMPORT_FAILED" });
        const safeWrapped = withoutQueryParameters(wrapped) as Error & { code?: string };

        assert.notEqual(safeWrapped, wrapped);
        assert.ok(safeWrapped instanceof Error);
        assert.equal(safeWrapped.message, "Import failed");
        assert.equal(safeWrapped.code, "IMPORT_FAILED");
        assert.deepEqual(framesOf(safeWrapped.stack), framesOf(wrapped.stack));
        assert.ok(safeWrapped.cause instanceof DatabaseQueryError);
        assert.equal(wrapped.cause, failed);
        assert.ok(!inspect(safeWrapped, { depth: 8 }).includes(MARKER));

        const aggregate = new AggregateError([new Error("first"), failedInsert()], "Both failed");
        const safeAggregate = withoutQueryParameters(aggregate) as AggregateError;
        assert.ok(safeAggregate instanceof AggregateError);
        assert.equal(safeAggregate.errors[0], aggregate.errors[0]);
        assert.ok(safeAggregate.errors[1] instanceof DatabaseQueryError);
        assert.ok(!inspect(loggableError(aggregate), { depth: 8 }).includes(MARKER));
    });

    test("leaves an error without a failed query as the same object", () => {
        const plain = new Error("boom", { cause: refusedOnBothAddresses() });

        assert.equal(withoutQueryParameters(plain), plain);
        assert.equal(withoutQueryParameters("timeout"), "timeout");
        assert.equal(withoutQueryParameters(undefined), undefined);
    });
});

describe("safeErrorMessage", () => {
    test("is the message, a failed query's without its parameters", () => {
        assert.equal(safeErrorMessage(failedInsert()), `Failed query: ${INSERT} (code 57014)`);
        assert.equal(safeErrorMessage(new Error("Plaid timed out")), "Plaid timed out");
        assert.equal(safeErrorMessage("plain text"), "plain text");
    });
});
