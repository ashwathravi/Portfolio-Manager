// The app keeps browser storage per signed-in user under `<key>:<user id>`
// (src/lib/storage/user-scope.ts). Every E2E mode signs in as fixture user A.
export const E2E_STORAGE_SCOPE = '00000000-0000-4000-8000-00000000a001';

export function userKey(base: string, scope: string = E2E_STORAGE_SCOPE): string {
    return `${base}:${scope}`;
}
