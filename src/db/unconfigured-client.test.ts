import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert";
import net from "node:net";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { DATABASE_POOL_OPTIONS } from "./connection-options.ts";
import { DatabaseNotConfiguredError, unconfiguredDatabaseOptions } from "./unconfigured-client.ts";

// Stands in for the Postgres postgres.js falls back to without a URL: a
// developer's own, or CI's service. Any connection to it is a failure.
let fallbackServer: net.Server;
let fallbackConnections = 0;
let client: postgres.Sql | undefined;

function unconfiguredClient() {
    client = postgres({ prepare: false, connect_timeout: 10, ...DATABASE_POOL_OPTIONS, ...unconfiguredDatabaseOptions() });
    return client;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe("unconfiguredDatabaseOptions", () => {
    before(async () => {
        fallbackServer = net.createServer((socket) => {
            fallbackConnections += 1;
            socket.destroy();
        });
        await new Promise<void>((resolve) => fallbackServer.listen(0, "127.0.0.1", resolve));
        process.env.PGHOST = "127.0.0.1";
        process.env.PGPORT = String((fallbackServer.address() as net.AddressInfo).port);
    });

    afterEach(async () => {
        await client?.end({ timeout: 1 });
        client = undefined;
        assert.strictEqual(fallbackConnections, 0, "connected to PGHOST/PGPORT");
    });

    after(() => {
        fallbackServer.close();
    });

    // More queries than the pool has connections: a client whose socket
    // factory throws answers the first five and leaves the sixth waiting.
    test("rejects each query at once, more queries than the pool has connections", async () => {
        const pg = unconfiguredClient();
        for (let i = 0; i < 12; i++) {
            await assert.rejects(within(pg`select 1`, 500), DatabaseNotConfiguredError, `query ${i}`);
        }
    });

    test("rejects many concurrent queries without any of them waiting", async () => {
        const pg = unconfiguredClient();
        const results = await within(Promise.allSettled(Array.from({ length: 20 }, () => pg`select 1`)), 1_000);
        for (const result of results) {
            assert.strictEqual(result.status, "rejected");
            assert.ok(result.reason instanceof DatabaseNotConfiguredError);
        }
    });

    test("rejects a transaction before its body runs", async () => {
        const pg = unconfiguredClient();
        let ran = false;
        await assert.rejects(
            within(pg.begin(async (tx) => {
                ran = true;
                await tx.unsafe("select 1");
            }), 500),
            DatabaseNotConfiguredError,
        );
        assert.strictEqual(ran, false);
    });

    test("through Drizzle, a plain error: the cause of a failed query, or a failed transaction itself", async () => {
        const db = drizzle(unconfiguredClient());

        const queryError = await within(db.execute(sql`select 1`), 500).then(
            () => assert.fail("query resolved"),
            (error: unknown) => error,
        );
        assert.ok(queryError instanceof Error);
        assert.ok(queryError.cause instanceof DatabaseNotConfiguredError);

        const transactionError = await within(db.transaction(async (tx) => tx.execute(sql`select 1`)), 500).then(
            () => assert.fail("transaction resolved"),
            (error: unknown) => error,
        );
        assert.ok(transactionError instanceof DatabaseNotConfiguredError);
        assert.ok(!(transactionError instanceof AggregateError));
        assert.strictEqual(transactionError.code, "DATABASE_NOT_CONFIGURED");
        assert.match(transactionError.message, /no connection was attempted/);
    });
});
