/**
 * The day a value given by hand is as of, shared by the forms that take
 * one: other assets and debts on Accounts (net-worth.ts re-exports the
 * rule) and holdings valued by hand on Holdings. Browser-safe.
 */

/** The browser's calendar day, YYYY-MM-DD: what "today" means to the person typing. */
export function localDate(now: Date = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * The day an edited value is as of until the user gives one: its own
 * while the value is as it was (to the cent), so a new name or note doesn't
 * date it anew or keep a value for a day nothing was valued; `today` once
 * the value changes, so the earlier value stays kept by its own day.
 */
export function editedValueAsOf(saved: { value: number; valueAsOf: string }, value: number | null, today: string): string {
    const cents = (n: number) => Math.round(n * 100);
    return value !== null && Number.isFinite(value) && cents(value) === cents(saved.value) ? saved.valueAsOf : today;
}
