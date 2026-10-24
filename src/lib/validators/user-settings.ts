import { z } from 'zod';

import {
    LIST_SETTINGS_SLICES,
    PERSISTED_SETTINGS_SLICES,
    SETTINGS_VERSION,
    type PersistedSettingsSlice,
} from '@/lib/settings/document';

/**
 * A settings document as PUT /api/settings receives it. Only the persisted
 * slices, each an object (or a list, for accounts and tags); what's inside a
 * slice is the store's business, and the store's migration normalizes it on
 * read (src/lib/stores/settingsStore.ts normalizeSettings). Documents from a
 * newer store version than this server knows are refused, so an old server
 * never stores what it can't read back.
 */
const objectSlice = z.record(z.string(), z.unknown());
// Accounts and tags are lists of objects, each with an id and a name the
// Settings page shows.
const listItem = z.looseObject({
    id: z.string({ message: 'accounts and tags need an id' }).min(1, 'accounts and tags need an id'),
    name: z.string({ message: 'accounts and tags need a name' }),
});
const listSlice = z.array(listItem, { message: 'accounts and tags must be lists of objects' });

const sliceShape = Object.fromEntries(
    PERSISTED_SETTINGS_SLICES.map((slice) => [slice, (LIST_SETTINGS_SLICES.has(slice) ? listSlice : objectSlice).optional()]),
) as Record<PersistedSettingsSlice, z.ZodOptional<typeof objectSlice | typeof listSlice>>;

export const settingsDocumentSchema = z.object({
    version: z
        .number({ message: 'version must be a number' })
        .int('version must be a whole number')
        .min(1, 'version must be at least 1')
        .max(SETTINGS_VERSION, `version must be at most ${SETTINGS_VERSION}`),
    settings: z.object(sliceShape).strict(),
    // The stored version the document was made on; null for a user's first save.
    baseUpdatedAt: z.union([z.iso.datetime({ message: 'baseUpdatedAt must be an ISO date-time' }), z.null()]),
}).strict();
