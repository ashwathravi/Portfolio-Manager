import type {
    PlaidAccountSubtype,
    PlaidAccountType,
    PlaidCapability,
    PlaidConnectedAccountInput,
    PlaidDiscoveredAccount,
    PlaidEnvironment,
    PlaidExchangeClientResponse,
    PlaidInstitution,
    PlaidLinkMetadata,
    PlaidLinkTokenResponse,
    PlaidPublicTokenExchangeResult,
} from "./types";

export interface PlaidCredentials {
    clientId: string;
    secret: string;
}

export interface PlaidFetchResponse {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}

export type PlaidFetch = (url: string, init: RequestInit) => Promise<PlaidFetchResponse>;

const DEFAULT_PRODUCTS = ["investments", "transactions"];
const DEFAULT_COUNTRY_CODES = ["US"];
const DEFAULT_CLIENT_NAME = "Atlas Wealth";

interface PlaidConnectedAccountLike {
    provider?: string;
    name: string;
    type: string;
    accountMask: string;
    institutionId?: string;
    institutionName?: string;
    plaidAccountId?: string;
}

export function plaidBaseUrl(environment: PlaidEnvironment): string {
    return `https://${environment}.plaid.com`;
}

export function resolvePlaidEnvironment(value: string | undefined): PlaidEnvironment {
    if (value === "production" || value === "development") return value;
    return "sandbox";
}

export async function createPlaidLinkToken({
    credentials,
    environment = "sandbox",
    clientUserId,
    clientName = DEFAULT_CLIENT_NAME,
    products = DEFAULT_PRODUCTS,
    countryCodes = DEFAULT_COUNTRY_CODES,
    redirectUri,
    webhook,
    fetchImpl = fetch,
}: {
    credentials: PlaidCredentials;
    environment?: PlaidEnvironment;
    clientUserId: string;
    clientName?: string;
    products?: readonly string[];
    countryCodes?: readonly string[];
    redirectUri?: string;
    webhook?: string;
    fetchImpl?: PlaidFetch;
}): Promise<PlaidLinkTokenResponse> {
    assertCredentials(credentials);
    const response = await postPlaid({
        endpoint: "/link/token/create",
        environment,
        credentials,
        fetchImpl,
        body: {
            client_name: clientName,
            language: "en",
            country_codes: [...countryCodes],
            products: [...products],
            user: {
                client_user_id: normalizeClientUserId(clientUserId),
            },
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
            ...(webhook ? { webhook } : {}),
        },
    });
    const data = asRecord(response);

    return {
        linkToken: readString(data, "link_token"),
        expiration: readString(data, "expiration"),
        requestId: readString(data, "request_id"),
        environment,
        products: [...products],
    };
}

export async function exchangePlaidPublicToken({
    credentials,
    environment = "sandbox",
    publicToken,
    linkMetadata,
    products = DEFAULT_PRODUCTS,
    selectedAccountIds,
    fetchImpl = fetch,
}: {
    credentials: PlaidCredentials;
    environment?: PlaidEnvironment;
    publicToken: string;
    linkMetadata?: PlaidLinkMetadata;
    products?: readonly string[];
    selectedAccountIds?: readonly string[];
    fetchImpl?: PlaidFetch;
}): Promise<PlaidPublicTokenExchangeResult> {
    assertCredentials(credentials);
    if (!publicToken.trim()) {
        throw new Error("Plaid public token is required");
    }

    const tokenResponse = asRecord(await postPlaid({
        endpoint: "/item/public_token/exchange",
        environment,
        credentials,
        fetchImpl,
        body: { public_token: publicToken },
    }));
    const accessToken = readString(tokenResponse, "access_token");
    const itemId = readString(tokenResponse, "item_id");
    const requestId = readString(tokenResponse, "request_id");

    const accountsResponse = asRecord(await postPlaid({
        endpoint: "/accounts/get",
        environment,
        credentials,
        fetchImpl,
        body: { access_token: accessToken },
    }));
    const selected = new Set(selectedAccountIds ?? []);
    const linkAccountsById = new Map((linkMetadata?.accounts ?? []).map((account) => [account.id, account]));
    const productsSet = new Set(products);
    const accounts = readArray(accountsResponse, "accounts")
        .map((account) =>
            mapPlaidAccount({
                account: asRecord(account),
                linkAccount: linkAccountsById.get(readOptionalString(asRecord(account), "account_id") ?? ""),
                institution: institutionFromMetadata(linkMetadata),
                products: productsSet,
            }),
        )
        .filter((account) => selected.size === 0 || selected.has(account.plaidAccountId));

    return {
        itemId,
        accessToken,
        institution: institutionFromMetadata(linkMetadata),
        accounts,
        requestId,
    };
}

export function sanitizePlaidExchangeForClient({
    exchange,
    existingPlaidAccountIds = [],
    accessTokenStored,
    accessTokenStorageMode = "memory",
    accessTokenStorageDurable = false,
}: {
    exchange: PlaidPublicTokenExchangeResult;
    existingPlaidAccountIds?: readonly string[];
    accessTokenStored: boolean;
    accessTokenStorageMode?: PlaidExchangeClientResponse["accessTokenStorageMode"];
    accessTokenStorageDurable?: boolean;
}): PlaidExchangeClientResponse {
    const existing = new Set(existingPlaidAccountIds);
    return {
        itemId: exchange.itemId,
        institution: exchange.institution,
        accounts: exchange.accounts,
        duplicatePlaidAccountIds: exchange.accounts
            .filter((account) => existing.has(account.plaidAccountId))
            .map((account) => account.plaidAccountId),
        accessTokenStored,
        accessTokenStorageMode,
        accessTokenStorageDurable,
        requestId: exchange.requestId,
    };
}

export function connectedPlaidAccountMatchesDiscovered(
    existing: PlaidConnectedAccountLike,
    discovered: PlaidDiscoveredAccount,
): boolean {
    if (existing.provider !== "plaid") return false;
    if (existing.plaidAccountId && existing.plaidAccountId === discovered.plaidAccountId) return true;

    return connectedPlaidAccountFingerprint(existing) === discoveredPlaidAccountFingerprint(discovered);
}

export function connectedPlaidAccountsMatch(
    existing: PlaidConnectedAccountLike,
    incoming: PlaidConnectedAccountInput,
): boolean {
    if (existing.provider !== "plaid") return false;
    if (existing.plaidAccountId && existing.plaidAccountId === incoming.plaidAccountId) return true;

    return connectedPlaidAccountFingerprint(existing) === connectedPlaidAccountFingerprint(incoming);
}

export function plaidAccountToConnectedAccount({
    account,
    itemId,
    lastSynced,
    tokenStorageMode,
    tokenStorageDurable,
    tokenStored = true,
}: {
    account: PlaidDiscoveredAccount;
    itemId: string;
    lastSynced: string;
    tokenStorageMode?: PlaidExchangeClientResponse["accessTokenStorageMode"];
    tokenStorageDurable?: boolean;
    tokenStored?: boolean;
}): PlaidConnectedAccountInput {
    return {
        id: `plaid-${account.plaidAccountId}`,
        provider: "plaid",
        name: account.name,
        type: `${titleCase(account.subtype)} · ${account.institution.name}`,
        accountMask: account.mask ? `****${account.mask}` : "****",
        holdings: account.capabilities.includes("investments") ? 1 : 0,
        accountValue: account.currentBalance,
        lastSynced,
        status: !tokenStored || account.verificationStatus === "unsupported" ? "needs-review" : "reconciled",
        institutionId: account.institution.id,
        institutionName: account.institution.name,
        plaidAccountId: account.plaidAccountId,
        plaidItemId: itemId,
        capabilities: [...account.capabilities],
        syncReady: tokenStored,
        tokenStorageMode,
        tokenStorageDurable,
        providerItemStatus: tokenStored ? "active" : "missing-token",
    };
}

function discoveredPlaidAccountFingerprint(account: PlaidDiscoveredAccount): string {
    return [
        normalizeFingerprintPart(account.institution.id || account.institution.name),
        normalizeFingerprintPart(account.name),
        normalizeAccountMask(account.mask),
        normalizeFingerprintPart(titleCase(account.subtype)),
    ].join("|");
}

function connectedPlaidAccountFingerprint(account: PlaidConnectedAccountLike): string {
    return [
        normalizeFingerprintPart(account.institutionId || account.institutionName),
        normalizeFingerprintPart(account.name),
        normalizeAccountMask(account.accountMask),
        normalizeFingerprintPart(account.type.split("·")[0]),
    ].join("|");
}

function normalizeAccountMask(value: string | undefined): string {
    return normalizeFingerprintPart(value?.replace(/\*/g, ""));
}

function normalizeFingerprintPart(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
}

async function postPlaid({
    endpoint,
    environment,
    credentials,
    body,
    fetchImpl,
}: {
    endpoint: string;
    environment: PlaidEnvironment;
    credentials: PlaidCredentials;
    body: Record<string, unknown>;
    fetchImpl: PlaidFetch;
}): Promise<unknown> {
    const response = await fetchImpl(`${plaidBaseUrl(environment)}${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: credentials.clientId,
            secret: credentials.secret,
            ...body,
        }),
    });
    const payload = await response.json();
    if (!response.ok) {
        const error = asRecord(payload);
        const message = readOptionalString(error, "error_message")
            ?? readOptionalString(error, "display_message")
            ?? `Plaid request failed with status ${response.status}`;
        throw new Error(message);
    }
    return payload;
}

function mapPlaidAccount({
    account,
    linkAccount,
    institution,
    products,
}: {
    account: Record<string, unknown>;
    linkAccount?: { verification_status?: string | null } | null;
    institution: PlaidInstitution;
    products: Set<string>;
}): PlaidDiscoveredAccount {
    const balances = asRecord(account.balances);
    const type = normalizeType(readOptionalString(account, "type"));
    const subtype = normalizeSubtype(readOptionalString(account, "subtype"));
    return {
        plaidAccountId: readString(account, "account_id"),
        name: readString(account, "name"),
        officialName: readOptionalString(account, "official_name") ?? undefined,
        mask: readOptionalString(account, "mask") ?? "",
        type,
        subtype,
        currentBalance: readNumber(balances, "current"),
        isoCurrencyCode: readOptionalString(balances, "iso_currency_code") ?? "USD",
        institution,
        capabilities: capabilitiesFor({ type, products }),
        verificationStatus: normalizeVerificationStatus(linkAccount?.verification_status),
    };
}

function capabilitiesFor({
    type,
    products,
}: {
    type: PlaidAccountType;
    products: Set<string>;
}): PlaidCapability[] {
    const capabilities = new Set<PlaidCapability>(["balances"]);
    if (products.has("transactions")) capabilities.add("transactions");
    if (products.has("investments") && type === "investment") {
        capabilities.add("holdings");
        capabilities.add("investments");
    }
    return [...capabilities];
}

function institutionFromMetadata(metadata: PlaidLinkMetadata | undefined): PlaidInstitution {
    return {
        id: metadata?.institution?.institution_id?.trim() || "unknown",
        name: metadata?.institution?.name?.trim() || "Plaid institution",
    };
}

function normalizeClientUserId(value: string): string {
    const normalized = value.trim().slice(0, 128);
    if (!normalized) throw new Error("Plaid client user id is required");
    return normalized;
}

function assertCredentials(credentials: PlaidCredentials): void {
    if (!credentials.clientId.trim() || !credentials.secret.trim()) {
        throw new Error("PLAID_CLIENT_ID and PLAID_SECRET are required");
    }
}

function normalizeType(value: string | undefined | null): PlaidAccountType {
    if (value === "investment" || value === "depository" || value === "credit" || value === "loan") {
        return value;
    }
    return "other";
}

function normalizeSubtype(value: string | undefined | null): PlaidAccountSubtype {
    if (
        value === "brokerage" ||
        value === "ira" ||
        value === "roth" ||
        value === "checking" ||
        value === "savings" ||
        value === "credit card"
    ) {
        return value;
    }
    return "other";
}

function normalizeVerificationStatus(
    value: string | null | undefined,
): PlaidDiscoveredAccount["verificationStatus"] {
    if (value === "pending_manual_verification") return value;
    if (value === "unsupported") return value;
    return "automatically_verified";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(record: Record<string, unknown>, key: string): string {
    const value = readOptionalString(record, key);
    if (value == null) {
        throw new Error(`Plaid response missing ${key}`);
    }
    return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
    const value = record[key];
    return Array.isArray(value) ? value : [];
}

function titleCase(value: string): string {
    return value
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
