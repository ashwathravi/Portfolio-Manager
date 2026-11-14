/**
 * Whether linked accounts can be synced and managed here (launch items
 * i44–i46): Plaid's keys, a database, and Plaid connections kept in it (the
 * local file or memory token vault keeps only the token). Production has
 * all three once Plaid's keys are set.
 */

import { isDatabaseConfigured } from "@/db/connection-options";

import { plaidConnectionsInDatabase } from "./server-token-vault";
import { plaidConfigFromEnv, type PlaidConfig } from "./sync";

export type PlaidAvailability =
    | { ok: true; config: PlaidConfig }
    | { ok: false; code: "PLAID_NOT_CONFIGURED" | "PLAID_CONNECTIONS_NOT_STORED"; message: string };

/**
 * What every Plaid route says without Plaid's keys or a database (x30), and
 * so what Settings shows in place of the Connect button.
 */
export const BANK_LINKING_NOT_SET_UP = "Bank linking isn't set up yet.";

export type PlaidLinking =
    | { ok: true; config: PlaidConfig }
    | { ok: false; code: "PLAID_NOT_CONFIGURED"; message: string };

/**
 * Whether Plaid Link can be opened here: Plaid's keys (x30). Without them the
 * link-token and public-token routes answer 503 PLAID_NOT_CONFIGURED before
 * anything else, rather than failing on the missing variable with a 500.
 */
export function plaidLinking(): PlaidLinking {
    const config = plaidConfigFromEnv();
    return config ? { ok: true, config } : { ok: false, code: "PLAID_NOT_CONFIGURED", message: BANK_LINKING_NOT_SET_UP };
}

export function plaidAvailability(): PlaidAvailability {
    const config = plaidConfigFromEnv();
    if (!config || !isDatabaseConfigured()) {
        return { ok: false, code: "PLAID_NOT_CONFIGURED", message: BANK_LINKING_NOT_SET_UP };
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
