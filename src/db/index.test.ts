import { after, before, describe, test } from "node:test";
import assert from "node:assert";
import net from "node:net";
import { sql } from "drizzle-orm";
import { DatabaseNotConfiguredError } from "./unconfigured-client.ts";

// The client reads DATABASE_URL when the module loads, so it is imported in
// before(), once the environment below is in place.
let db: typeof import("./index.ts").db;

// Where postgres.js would go without a URL. Any connection to it is a failure.
let fallbackServer: net.Server;
let fallbackConnections = 0;

describe("db with an unusable DATABASE_URL", () => {
    before(async () => {
        fallbackServer = net.createServer((socket) => {
            fallbackConnections += 1;
            socket.destroy();
        });
        await new Promise<void>((resolve) => fallbackServer.listen(0, "127.0.0.1", resolve));
        process.env.PGHOST = "127.0.0.1";
        process.env.PGPORT = String((fallbackServer.address() as net.AddressInfo).port);
        // Vercel's placeholder for a Sensitive variable, as the 3200 E2E server has.
        process.env.DATABASE_URL = "[SENSITIVE]";

        const warn = console.warn;
        console.warn = () => {};
        try {
            ({ db } = await import("./index.ts"));
        } finally {
            console.warn = warn;
        }
    });

    after(async () => {
        await db?.$client.end({ timeout: 1 });
        fallbackServer.close();
    });

    // Regression: the client fell back to PGHOST/PGPORT or localhost:5432, so
    // pages on a machine with its own Postgres (or CI) really connected.
    test("rejects queries and transactions without connecting to PGHOST/PGPORT", async () => {
        const queryError = await db.execute(sql`select 1`).then(
            () => assert.fail("query resolved"),
            (error: unknown) => error,
        );
        assert.ok(queryError instanceof Error);
        assert.ok(queryError.cause instanceof DatabaseNotConfiguredError);

        await assert.rejects(db.transaction(async (tx) => tx.execute(sql`select 1`)), DatabaseNotConfiguredError);

        assert.strictEqual(fallbackConnections, 0);
    });
});
