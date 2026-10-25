"use client";

import { useRouter } from "next/navigation";

/**
 * All accounts or one, on the Performance pages that read history: the
 * choice is the page's `?account=`, so the server renders that account and
 * the link can be kept. Hidden with fewer than two accounts.
 */
export function AccountSwitcher({
    accounts,
    accountId,
    path,
}: {
    accounts: ReadonlyArray<{ id: string; name: string }>;
    accountId: string | null;
    /** The page's path, e.g. "/performance". */
    path: string;
}) {
    const router = useRouter();
    if (accounts.length < 2) return null;
    return (
        <label className="pm-perf-bench-select">
            <span className="pm-perf-bench-label">Account</span>
            <select
                className="pm-sort-select"
                aria-label="Account"
                value={accountId ?? ""}
                onChange={(e) => {
                    const id = e.target.value;
                    router.push(id ? `${path}?account=${encodeURIComponent(id)}` : path, { scroll: false });
                }}
            >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
