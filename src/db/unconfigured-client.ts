import { Duplex } from "node:stream";
import type postgres from "postgres";

/**
 * What every query rejects with when there is no usable DATABASE_URL. A plain
 * Error (Drizzle reports it as the cause of its DrizzleQueryError), so it logs
 * from a render like any other error.
 */
export class DatabaseNotConfiguredError extends Error {
    readonly code = "DATABASE_NOT_CONFIGURED";

    constructor() {
        super("No database is configured (DATABASE_URL is missing or not a URL), so no connection was attempted.");
        this.name = "DatabaseNotConfiguredError";
    }
}

/**
 * postgres.js documents `socket` ("a function returning a socket-like duplex
 * stream") but leaves it out of its types.
 */
type UnconfiguredDatabaseOptions = Pick<postgres.Options<Record<string, never>>, "host" | "ssl" | "backoff"> & {
    socket: () => Duplex;
};

/**
 * A socket that fails the first thing written to it: the startup message, so
 * the query that opened the connection rejects. The write fails rather than
 * the factory throwing because postgres.js never returns a connection whose
 * factory threw to its pool: after `max` of them, every query would wait
 * forever. A socket that errors and closes takes the path of a refused
 * connection instead.
 */
function failingSocket(): Duplex {
    return new Duplex({
        read() {},
        write(_chunk, _encoding, callback) {
            callback(new DatabaseNotConfiguredError());
        },
    });
}

/**
 * Client options for when there is no usable DATABASE_URL. Without a URL
 * postgres.js would connect to PGHOST/PGPORT or localhost:5432, which is
 * whatever Postgres a developer runs, or CI's Postgres service. With these,
 * each query rejects at once with DatabaseNotConfiguredError and nothing
 * reaches the network.
 */
export function unconfiguredDatabaseOptions(): UnconfiguredDatabaseOptions {
    return {
        // Set so PGHOST plays no part; the socket below never connects to it.
        host: "database-not-configured.invalid",
        // A TLS handshake would wait on the socket for an answer.
        ssl: false,
        // Nothing to wait for between attempts.
        backoff: () => 0,
        socket: failingSocket,
    };
}
