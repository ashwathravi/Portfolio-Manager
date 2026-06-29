const CLIENT_API_USER_ID_STORAGE_KEY = "atlas.apiUserId";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ClientStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}

export function clientApiScopeHeaders(headers?: HeadersInit): Headers {
    const scopedHeaders = new Headers(headers);
    if (scopedHeaders.has("x-user-id")) return scopedHeaders;

    const userId = resolveClientApiUserId();
    if (userId) scopedHeaders.set("x-user-id", userId);
    return scopedHeaders;
}

export function resolveClientApiUserId({
    storage = readBrowserStorage(),
    randomUuid = readRandomUuid,
}: {
    storage?: ClientStorage;
    randomUuid?: () => string | null;
} = {}): string | null {
    if (!storage) return null;

    try {
        const existing = storage.getItem(CLIENT_API_USER_ID_STORAGE_KEY)?.trim();
        if (existing && UUID_RE.test(existing)) return existing;

        const generated = randomUuid();
        if (!generated || !UUID_RE.test(generated)) return null;
        storage.setItem(CLIENT_API_USER_ID_STORAGE_KEY, generated);
        return generated;
    } catch {
        return null;
    }
}

function readBrowserStorage(): ClientStorage | undefined {
    return typeof window === "undefined" ? undefined : window.localStorage;
}

function readRandomUuid(): string | null {
    return globalThis.crypto?.randomUUID?.() ?? null;
}
