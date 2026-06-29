import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { plaidAccounts, plaidItems } from "@/db/schema";
import type { PlaidDiscoveredAccount, PlaidPublicTokenExchangeResult } from "./types";

export type PlaidTokenStorageMode = "memory" | "encrypted_file" | "postgres";

export interface PlaidTokenStorageResult {
    stored: boolean;
    durable: boolean;
    mode: PlaidTokenStorageMode;
    reason?: string;
}

interface EncryptedVaultEntry {
    iv: string;
    tag: string;
    ciphertext: string;
    updatedAt: string;
}

interface EncryptedTokenPayload {
    iv: string;
    tag: string;
    ciphertext: string;
}

interface EncryptedVaultFile {
    version: 1;
    items: Record<string, EncryptedVaultEntry>;
}

interface PlaidTokenRegistryConnectionInput {
    userId: string;
    itemId: string;
    institutionId: string;
    institutionName: string;
    encryptedToken: EncryptedTokenPayload;
    keyVersion: string;
    accounts: PlaidDiscoveredAccount[];
    lastSuccessfulSyncAt: Date;
    now: Date;
}

interface PlaidTokenRegistryToken {
    ciphertext: string;
    iv: string;
    tag: string;
    keyVersion: string;
}

interface PlaidTokenRegistryStore {
    configured: () => boolean;
    upsertConnection: (input: PlaidTokenRegistryConnectionInput) => Promise<void>;
    getActiveToken: (input: { userId: string; itemId: string }) => Promise<PlaidTokenRegistryToken | undefined>;
    revokeConnection: (input: { userId: string; itemId: string; now: Date }) => Promise<void>;
}

const plaidAccessTokenByScope = new Map<string, string>();
const VAULT_VERSION = 1;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_KEY_VERSION = "v1";

const drizzlePlaidTokenRegistryStore: PlaidTokenRegistryStore = {
    configured: () => Boolean(process.env.DATABASE_URL?.trim()),
    async upsertConnection(input) {
        const [item] = await db.insert(plaidItems)
            .values({
                userId: input.userId,
                plaidItemId: input.itemId,
                institutionId: input.institutionId,
                institutionName: input.institutionName,
                status: "active",
                accessTokenCiphertext: input.encryptedToken.ciphertext,
                accessTokenIv: input.encryptedToken.iv,
                accessTokenAuthTag: input.encryptedToken.tag,
                keyVersion: input.keyVersion,
                lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
                revokedAt: null,
                updatedAt: input.now,
            })
            .onConflictDoUpdate({
                target: [plaidItems.userId, plaidItems.plaidItemId],
                set: {
                    institutionId: input.institutionId,
                    institutionName: input.institutionName,
                    status: "active",
                    accessTokenCiphertext: input.encryptedToken.ciphertext,
                    accessTokenIv: input.encryptedToken.iv,
                    accessTokenAuthTag: input.encryptedToken.tag,
                    keyVersion: input.keyVersion,
                    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
                    revokedAt: null,
                    updatedAt: input.now,
                },
            })
            .returning({ id: plaidItems.id });

        if (!item) throw new Error("Unable to upsert Plaid item token registry row.");

        for (const account of input.accounts) {
            await db.insert(plaidAccounts)
                .values({
                    userId: input.userId,
                    plaidItemRecordId: item.id,
                    plaidAccountId: account.plaidAccountId,
                    name: account.name,
                    officialName: account.officialName ?? null,
                    mask: account.mask || null,
                    type: account.type,
                    subtype: account.subtype,
                    currentBalance: Number.isFinite(account.currentBalance) ? String(account.currentBalance) : null,
                    isoCurrencyCode: account.isoCurrencyCode,
                    institutionId: account.institution.id,
                    institutionName: account.institution.name,
                    capabilities: [...account.capabilities],
                    verificationStatus: account.verificationStatus,
                    syncStatus: "sync_ready",
                    lastSyncedAt: input.now,
                    updatedAt: input.now,
                })
                .onConflictDoUpdate({
                    target: [plaidAccounts.userId, plaidAccounts.plaidAccountId],
                    set: {
                        plaidItemRecordId: item.id,
                        name: account.name,
                    officialName: account.officialName ?? null,
                    mask: account.mask || null,
                        type: account.type,
                        subtype: account.subtype,
                        currentBalance: Number.isFinite(account.currentBalance) ? String(account.currentBalance) : null,
                        isoCurrencyCode: account.isoCurrencyCode,
                        institutionId: account.institution.id,
                        institutionName: account.institution.name,
                        capabilities: [...account.capabilities],
                        verificationStatus: account.verificationStatus,
                        syncStatus: "sync_ready",
                        lastSyncedAt: input.now,
                        updatedAt: input.now,
                    },
                });
        }
    },
    async getActiveToken({ userId, itemId }) {
        const [item] = await db.select({
            ciphertext: plaidItems.accessTokenCiphertext,
            iv: plaidItems.accessTokenIv,
            tag: plaidItems.accessTokenAuthTag,
            keyVersion: plaidItems.keyVersion,
        })
            .from(plaidItems)
            .where(and(
                eq(plaidItems.userId, userId),
                eq(plaidItems.plaidItemId, itemId),
                eq(plaidItems.status, "active"),
                isNull(plaidItems.revokedAt),
            ))
            .limit(1);

        return item;
    },
    async revokeConnection({ userId, itemId, now }) {
        await db.update(plaidItems)
            .set({
                status: "revoked",
                revokedAt: now,
                updatedAt: now,
            })
            .where(and(
                eq(plaidItems.userId, userId),
                eq(plaidItems.plaidItemId, itemId),
            ));
    },
};

let plaidTokenRegistryStore: PlaidTokenRegistryStore = drizzlePlaidTokenRegistryStore;

export function setPlaidTokenRegistryStoreForTests(store: PlaidTokenRegistryStore | null): void {
    plaidTokenRegistryStore = store ?? drizzlePlaidTokenRegistryStore;
}

export async function storePlaidConnection({
    exchange,
    userId,
    now = new Date(),
}: {
    exchange: PlaidPublicTokenExchangeResult;
    userId: string;
    now?: Date;
}): Promise<PlaidTokenStorageResult> {
    if (!shouldUsePostgresTokenRegistry()) {
        return storePlaidAccessToken({
            itemId: exchange.itemId,
            accessToken: exchange.accessToken,
            userId,
        });
    }

    if (!exchange.itemId || !exchange.accessToken) {
        return {
            stored: false,
            durable: false,
            mode: "postgres",
            reason: "Missing Plaid item id or access token.",
        };
    }

    const scopedUserId = userId.trim();
    if (!scopedUserId) {
        return {
            stored: false,
            durable: false,
            mode: "postgres",
            reason: "Authenticated user id is required for durable Plaid token storage.",
        };
    }

    if (!plaidTokenRegistryStore.configured()) {
        return {
            stored: false,
            durable: false,
            mode: "postgres",
            reason: "DATABASE_URL is required for durable Plaid token storage.",
        };
    }

    const encryptionSecret = readEncryptionSecret();
    if (!encryptionSecret) {
        return {
            stored: false,
            durable: false,
            mode: "postgres",
            reason: "PLAID_TOKEN_ENCRYPTION_KEY or managed key material is required for durable Plaid token storage.",
        };
    }

    try {
        await plaidTokenRegistryStore.upsertConnection({
            userId: scopedUserId,
            itemId: exchange.itemId,
            institutionId: exchange.institution.id,
            institutionName: exchange.institution.name,
            encryptedToken: encryptToken(exchange.accessToken, encryptionSecret),
            keyVersion: readKeyVersion(),
            accounts: exchange.accounts,
            lastSuccessfulSyncAt: now,
            now,
        });
        plaidAccessTokenByScope.set(vaultItemKey(exchange.itemId, scopedUserId), exchange.accessToken);

        return {
            stored: true,
            durable: true,
            mode: "postgres",
        };
    } catch {
        return {
            stored: false,
            durable: false,
            mode: "postgres",
            reason: "Durable Plaid token registry write failed.",
        };
    }
}

export async function getPlaidAccessTokenForUser(itemId: string, userId: string): Promise<string | undefined> {
    if (!shouldUsePostgresTokenRegistry()) {
        return getPlaidAccessToken(itemId, userId);
    }

    const scopedUserId = userId.trim();
    if (!itemId.trim() || !scopedUserId || !plaidTokenRegistryStore.configured()) return undefined;

    const cached = plaidAccessTokenByScope.get(vaultItemKey(itemId, scopedUserId));
    if (cached) return cached;

    const encryptionSecret = readEncryptionSecret();
    if (!encryptionSecret) return undefined;

    try {
        const token = await plaidTokenRegistryStore.getActiveToken({ userId: scopedUserId, itemId });
        if (!token) return undefined;
        const accessToken = decryptToken({
            ciphertext: token.ciphertext,
            iv: token.iv,
            tag: token.tag,
            updatedAt: new Date().toISOString(),
        }, encryptionSecret);
        plaidAccessTokenByScope.set(vaultItemKey(itemId, scopedUserId), accessToken);
        return accessToken;
    } catch {
        return undefined;
    }
}

export async function revokePlaidConnectionForUser({
    itemId,
    userId,
    now = new Date(),
}: {
    itemId: string;
    userId: string;
    now?: Date;
}): Promise<void> {
    plaidAccessTokenByScope.delete(vaultItemKey(itemId, userId));
    if (!shouldUsePostgresTokenRegistry() || !plaidTokenRegistryStore.configured()) return;
    await plaidTokenRegistryStore.revokeConnection({ userId, itemId, now });
}

export function storePlaidAccessToken({
    itemId,
    accessToken,
    userId,
}: {
    itemId: string;
    accessToken: string;
    userId?: string | null;
}): PlaidTokenStorageResult {
    if (!itemId || !accessToken) {
        return {
            stored: false,
            durable: false,
            mode: "memory",
            reason: "Missing Plaid item id or access token.",
        };
    }

    const encryptionSecret = readEncryptionSecret();
    if (!encryptionSecret) {
        if (process.env.NODE_ENV === "production") {
            return {
                stored: false,
                durable: false,
                mode: "memory",
                reason: "Production Plaid token storage requires PLAID_TOKEN_ENCRYPTION_KEY or a managed token vault.",
            };
        }

        plaidAccessTokenByScope.set(vaultItemKey(itemId, userId), accessToken);
        return {
            stored: true,
            durable: false,
            mode: "memory",
            reason: "Set PLAID_TOKEN_ENCRYPTION_KEY or INTERNAL_API_SECRET to persist Plaid access tokens across server restarts.",
        };
    }

    try {
        const vault = readVault();
        vault.items[vaultItemKey(itemId, userId)] = encryptToken(accessToken, encryptionSecret);
        writeVault(vault);
        plaidAccessTokenByScope.set(vaultItemKey(itemId, userId), accessToken);
        return {
            stored: true,
            durable: true,
            mode: "encrypted_file",
        };
    } catch {
        plaidAccessTokenByScope.set(vaultItemKey(itemId, userId), accessToken);
        return {
            stored: true,
            durable: false,
            mode: "memory",
            reason: "Encrypted Plaid token vault write failed; token is cached in this server process only.",
        };
    }
}

export function getPlaidAccessToken(itemId: string, userId?: string | null): string | undefined {
    const key = vaultItemKey(itemId, userId);
    const cached = plaidAccessTokenByScope.get(key);
    if (cached) return cached;

    const encryptionSecret = readEncryptionSecret();
    if (!encryptionSecret) return undefined;

    try {
        const entry = readVault().items[key];
        if (!entry) return undefined;
        const token = decryptToken(entry, encryptionSecret);
        plaidAccessTokenByScope.set(key, token);
        return token;
    } catch {
        return undefined;
    }
}

export function hasPlaidAccessToken(itemId: string, userId?: string | null): boolean {
    return Boolean(getPlaidAccessToken(itemId, userId));
}

export function resetPlaidTokenVaultForTests({ clearFile = false } = {}): void {
    plaidAccessTokenByScope.clear();
    if (!clearFile) return;
    const path = vaultPath();
    if (existsSync(path)) unlinkSync(path);
}

function vaultItemKey(itemId: string, userId?: string | null): string {
    const scopedUserId = userId?.trim();
    return scopedUserId ? `${scopedUserId}:${itemId}` : itemId;
}

function readEncryptionSecret(): string | undefined {
    const explicit = process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();
    if (explicit) return explicit;
    const internalSecret = process.env.INTERNAL_API_SECRET?.trim();
    return internalSecret || undefined;
}

function readKeyVersion(): string {
    return process.env.PLAID_TOKEN_KEY_VERSION?.trim() || DEFAULT_KEY_VERSION;
}

function shouldUsePostgresTokenRegistry(): boolean {
    return process.env.PLAID_TOKEN_STORAGE?.trim() === "postgres" || process.env.NODE_ENV === "production";
}

function vaultPath(): string {
    return resolve(
        /* turbopackIgnore: true */ process.cwd(),
        process.env.PLAID_TOKEN_VAULT_PATH?.trim() || ".runtime/plaid-token-vault.json",
    );
}

function readVault(): EncryptedVaultFile {
    const path = vaultPath();
    if (!existsSync(path)) {
        return { version: VAULT_VERSION, items: {} };
    }

    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EncryptedVaultFile>;
    if (parsed.version !== VAULT_VERSION || !parsed.items || typeof parsed.items !== "object") {
        return { version: VAULT_VERSION, items: {} };
    }

    return {
        version: VAULT_VERSION,
        items: parsed.items as Record<string, EncryptedVaultEntry>,
    };
}

function writeVault(vault: EncryptedVaultFile): void {
    const path = vaultPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 });
}

function encryptToken(token: string, secret: string): EncryptedVaultEntry {
    const key = deriveKey(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        updatedAt: new Date().toISOString(),
    };
}

function decryptToken(entry: EncryptedVaultEntry, secret: string): string {
    const decipher = createDecipheriv(
        "aes-256-gcm",
        deriveKey(secret),
        Buffer.from(entry.iv, "base64"),
        { authTagLength: AUTH_TAG_LENGTH },
    );
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, "base64")),
        decipher.final(),
    ]).toString("utf8");
}

function deriveKey(secret: string): Buffer {
    return createHash("sha256").update(secret).digest();
}
