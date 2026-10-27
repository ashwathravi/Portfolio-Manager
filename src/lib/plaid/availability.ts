/**
 * Whether linked accounts can be synced and managed here (launch items
 * i44–i46): Plaid's keys, a database, and Plaid connections kept in it (the
 * local file or memory token vault keeps only the token). Production has
 * all three.
 */

import { isDatabaseConfigured } from "@/db/connection-options";

import { plaidConnectionsInDatabase } from "./server-token-vault";
import { plaidConfigFromEnv, type PlaidConfig } from "./sync";

export type PlaidAvailability =
    | { ok: true; config: PlaidConfig }
    | { ok: false; code: "PLAID_NOT_CONFIGURED" | "PLAID_CONNECTIONS_NOT_STORED"; message: string };

export function plaidAvailability(): PlaidAvailability {
    const config = plaidConfigFromEnv();
    if (!config || !isDatabaseConfigured()) {
        return { ok: false, code: "PLAID_NOT_CONFIGURED", message: "Linked accounts can't sync here: Plaid isn't set up." };
    }
    if (!plaidConnectionsInDatabase()) {
        return {
            ok: false,
            code: "PLAID_CONNECTIONS_NOT_STORED",
            message: "Linked accounts can't sync here: Plaid connections aren't kept in the database (set PLAID_TOKEN_STORAGE=postgres).",
        };
    }
    return { ok: true, config };
}
