import { z } from 'zod';

import { FIRST_SAVED_SETTINGS_VERSION, SETTINGS_VERSION } from '@/lib/settings/document';

import { findSettingsIssue } from './settings-slices';

/**
 * A settings document as PUT /api/settings receives it: the persisted slices
 * at a store version this server knows, every field as the app writes it
 * (./settings-slices.ts), so a hand-made request can't store a value that
 * breaks a page later. The first field that isn't names the error. Documents
 * from a newer store version than this server knows are refused, so an old
 * server never stores what it can't read back, as are documents older than
 * any browser saves.
 */
export const settingsDocumentSchema = z.object({
    version: z
        .number({ message: 'version must be a number' })
        .int('version must be a whole number')
        .min(FIRST_SAVED_SETTINGS_VERSION, `version must be at least ${FIRST_SAVED_SETTINGS_VERSION}`)
        .max(SETTINGS_VERSION, `version must be at most ${SETTINGS_VERSION}`),
    settings: z.record(z.string(), z.unknown(), { message: 'settings must be an object' }),
    // The stored version the document was made on; null for a user's first save.
    baseUpdatedAt: z.union([z.iso.datetime({ message: 'baseUpdatedAt must be an ISO date-time' }), z.null()]),
}).strict().superRefine(({ version, settings }, ctx) => {
    const issue = findSettingsIssue(settings, version);
    if (issue) ctx.addIssue({ code: 'custom', path: ['settings', ...issue.path], message: issue.message });
});
