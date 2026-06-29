export interface ResponseTextLimitOptions {
    url: string;
    maxBytes: number;
    label: string;
}

export interface RequestTimeout {
    signal?: AbortSignal;
    clear: () => void;
}

const TEXT_ENCODER = new TextEncoder();

export function createRequestTimeout(timeoutMs: number): RequestTimeout {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return { clear: () => undefined };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    return {
        signal: controller.signal,
        clear: () => clearTimeout(timeout),
    };
}

export async function readResponseTextWithLimit(
    response: Response,
    options: ResponseTextLimitOptions,
): Promise<string> {
    const maxBytes = Math.max(0, options.maxBytes);
    if (maxBytes === 0) return response.text();

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${options.label} response for ${options.url} exceeds ${formatBytes(maxBytes)}.`);
    }

    if (!response.body) {
        const text = await response.text();
        if (TEXT_ENCODER.encode(text).byteLength > maxBytes) {
            throw new Error(`${options.label} response for ${options.url} exceeds ${formatBytes(maxBytes)}.`);
        }
        return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let receivedBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            receivedBytes += value.byteLength;
            if (receivedBytes > maxBytes) {
                await reader.cancel();
                throw new Error(`${options.label} response for ${options.url} exceeds ${formatBytes(maxBytes)}.`);
            }

            chunks.push(decoder.decode(value, { stream: true }));
        }
    } finally {
        reader.releaseLock();
    }

    chunks.push(decoder.decode());
    return chunks.join("");
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
