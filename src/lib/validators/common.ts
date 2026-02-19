import { z } from 'zod';

/**
 * Checks if a string contains potentially dangerous HTML characters.
 * Rejects strings containing < or >.
 */
export const noHtmlTags = (val: string) => !/[<>]/.test(val);

export const safeText = z.string().refine(noHtmlTags, {
    message: "Input contains invalid characters (< or >)",
});
