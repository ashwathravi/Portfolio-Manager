// Exits 0 only when nothing is listening on the given port on localhost
// (IPv4 or IPv6). Exits 1 when something is, and 2 when it can't tell, so
// callers fail closed: Playwright would reuse whatever server holds the port.
//
//   node scripts/e2e/check-port-free.mjs 3000
import net from "node:net";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("Usage: node scripts/e2e/check-port-free.mjs <port>");
    process.exit(2);
}

// Connection errors that prove nothing is listening on that address. An
// address family the machine doesn't support can't have a listener either.
const NOTHING_LISTENING = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "ENETUNREACH", "EAFNOSUPPORT"]);

function probe(host) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(2000);
        socket.once("connect", () => {
            socket.destroy();
            resolve("in-use");
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve("unknown");
        });
        socket.once("error", (error) => {
            resolve(NOTHING_LISTENING.has(error.code) ? "free" : "unknown");
        });
    });
}

const results = await Promise.all(["127.0.0.1", "::1"].map(probe));
if (results.includes("in-use")) {
    console.error(`Port ${port} is in use. Stop your dev server first; Playwright would reuse it.`);
    process.exit(1);
}
if (results.includes("unknown")) {
    console.error(`Could not tell whether port ${port} is free. Refusing to start E2E.`);
    process.exit(2);
}
