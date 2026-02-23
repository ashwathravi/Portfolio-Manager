import { z } from 'zod';

/**
 * Checks if a string contains potentially dangerous HTML characters.
 * Rejects strings containing < or >.
 */
export const noHtmlTags = (val: string) => !/[<>]/.test(val);

/**
 * Checks if a string starts with = to prevent CSV/Formula Injection.
 * Rejects strings starting with =.
 * Note: While +, -, and @ can also start formulas, they are common in valid text (e.g. phone numbers, handles).
 * We only block = which is highly unlikely to start a valid name or text field.
 */
export const noStartingEquals = (val: string) => !val.startsWith('=');

export const safeText = z.string()
    .refine(noHtmlTags, { message: "Input contains invalid characters (< or >)" })
    .refine(noStartingEquals, { message: "Input cannot start with =" });
