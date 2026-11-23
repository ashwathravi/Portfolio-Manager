/** Plaid retired its Development environment in 2024; Sandbox and Production remain. */
export type PlaidEnvironment = "sandbox" | "production";

export type PlaidAccountType =
    | "investment"
    | "depository"
    | "credit"
    | "loan"
    | "other";

/**
 * Plaid's subtype, lower-cased, as Atlas stores it: one Atlas has an
 * account kind for ("brokerage", "401k", "529", "hsa": accountTypeForPlaid
 * in src/lib/portfolio/account-kinds.ts), "checking", "savings" or
 * "credit card", or else "other".
 */
export type PlaidAccountSubtype = string;

export type PlaidCapability = "balances" | "holdings" | "transactions" | "investments";

export interface PlaidInstitution {
    id: string;
    name: string;
}

export interface PlaidLinkMetadataAccount {
    id: string;
    name: string;
    mask?: string | null;
    type?: string | null;
    subtype?: string | null;
    verification_status?: string | null;
}

export interface PlaidLinkMetadata {
    institution?: {
        name?: string | null;
        institution_id?: string | null;
    } | null;
    accounts?: PlaidLinkMetadataAccount[];
    link_session_id?: string | null;
}

export interface PlaidLinkTokenResponse {
    linkToken: string;
    expiration: string;
    requestId: string;
    environment: PlaidEnvironment;
    products: string[];
}

export interface PlaidDiscoveredAccount {
    plaidAccountId: string;
    name: string;
    officialName?: string;
    mask: string;
    type: PlaidAccountType;
    subtype: PlaidAccountSubtype;
    currentBalance: number;
    isoCurrencyCode: string;
    institution: PlaidInstitution;
    capabilities: PlaidCapability[];
    verificationStatus: "automatically_verified" | "pending_manual_verification" | "unsupported";
}

export interface PlaidPublicTokenExchangeResult {
    itemId: string;
    accessToken: string;
    institution: PlaidInstitution;
    accounts: PlaidDiscoveredAccount[];
    requestId: string;
}

export interface PlaidExchangeClientResponse {
    itemId: string;
    institution: PlaidInstitution;
    accounts: PlaidDiscoveredAccount[];
    duplicatePlaidAccountIds: string[];
    accessTokenStored: boolean;
    accessTokenStorageMode: "memory" | "encrypted_file" | "postgres";
    accessTokenStorageDurable: boolean;
    requestId: string;
}

export interface PlaidConnectedAccountInput {
    id: string;
    provider: "plaid";
    name: string;
    type: string;
    accountMask: string;
    holdings: number;
    accountValue: number;
    lastSynced: string;
    status: "reconciled" | "needs-review" | "error";
    institutionId: string;
    institutionName: string;
    plaidAccountId: string;
    plaidItemId: string;
    capabilities: PlaidCapability[];
    syncReady?: boolean;
    tokenStorageMode?: PlaidExchangeClientResponse["accessTokenStorageMode"];
    tokenStorageDurable?: boolean;
    providerItemStatus?: "active" | "missing-token" | "revoked" | "reconnected";
}
