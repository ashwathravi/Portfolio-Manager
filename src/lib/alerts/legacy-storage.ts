/**
 * Where this browser kept alert rules and triggers before they moved to the
 * account (launch item i57). Nothing reads it now; it stays listed with the
 * formerly shared keys so deleting an account still clears an old copy.
 */
export const ALERTS_STORAGE_KEY = 'atlas-alerts';
