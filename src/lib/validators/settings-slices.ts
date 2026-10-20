import { z } from 'zod';

import { POLICY_BUCKETS } from '@/lib/risk-policy/buckets';
import { CASH_JOB_TYPES } from '@/lib/risk-policy/cash';
import {
    EMPLOYER_STOCK_PLAN_STATES,
    EMPLOYER_STOCK_TRIM_CADENCES,
    EMPLOYER_STOCK_TRIM_METHODS,
    EMPLOYER_STOCK_VEST_ACTIONS,
} from '@/lib/risk-policy/de-risking';
import { SELL_DISCIPLINE_TRIGGER_TYPES } from '@/lib/risk-policy/sell-discipline';
import { THEME_IDS } from '@/lib/risk-policy/themes';
import { SETTINGS_VERSION, type PersistedSettingsSlice } from '@/lib/settings/document';

import { preferencesSchema } from './settings';

/**
 * Every persisted slice of the settings store (launch item i37), field by
 * field, optional fields included: the types in
 * src/lib/stores/settingsStore.ts and src/lib/risk-policy/*, which
 * settings-slices.test.ts checks these against. Kept free of the store so the
 * server can use them without loading client code.
 *
 * They accept what the app can write and no more: the bounds are the ones
 * the Settings inputs clamp to, and unknown fields are refused. Two uses:
 *   - Saving (PUT /api/settings): `findSettingsIssue` names the first field
 *     the app could not have written.
 *   - Loading (normalizeSettings in the store): `sanitizeSettings` repairs
 *     whatever a stored or browser copy holds, so no page meets a value of
 *     the wrong kind.
 *
 * A new field goes here, in the store's type and in its defaults, with a bump
 * of SETTINGS_VERSION and a migration step: documents from an older version
 * (a tab not reloaded since the deploy) are checked only on the fields they
 * have.
 */

// --- Fields ---------------------------------------------------------------

const text = z.string();
const flag = z.boolean();
/** What identifies or names a list item. */
const nonEmpty = z.string().min(1);
const nonNegative = z.number().min(0);
const percent = z.number().min(0).max(100);
const whole = (min: number, max: number) => z.number().int().min(min).max(max);
/** The employer-stock plan's dollar inputs clamp to $10M. */
const planUsd = z.number().min(0).max(10_000_000);
const days = z.number().int().min(0);
// Messages that start with "must" are shown as they are (see describeIssue).
/** From a date input, or `toISOString().slice(0, 10)`. */
const calendarDate = z.iso.date({ error: 'must be a date (YYYY-MM-DD)' });
/** From `toISOString()`. */
const timestamp = z.iso.datetime({ offset: true, error: 'must be an ISO date-time' });
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { error: 'must be a hex colour such as #17cf54' });

/** src/lib/plaid/types.ts PlaidCapability. */
const PLAID_CAPABILITIES = ['balances', 'holdings', 'transactions', 'investments'] as const;

// --- Slices ---------------------------------------------------------------

export const profileSettingsSchema = z.strictObject({
    fullName: text,
    email: text,
    phone: text,
});

export const appearanceSettingsSchema = z.strictObject({
    theme: z.enum(['light', 'dim', 'dark', 'system']),
    density: z.enum(['comfortable', 'compact']),
    compactMode: flag,
    animationsEnabled: flag,
    // Feeds --pm-accent; the app only offers hex presets.
    accent: hexColor,
});

export const notificationSettingsSchema = z.strictObject({
    portfolioUpdates: flag,
    priceAlerts: flag,
    alphaRadarSignals: flag,
    strategySignals: flag,
    accountSync: flag,
    weeklySummary: flag,
});

export const alphaRadarDeliverySettingsSchema = z.strictObject({
    enabled: flag,
    channels: z.strictObject({ inApp: flag, email: flag, slack: flag, telegram: flag }),
    failureSummaries: flag,
    overlapOnly: flag,
    minMaterialityScore: percent,
    tickerFilters: z.array(text),
    fundStyleFilters: z.array(text),
    trackedFilerIds: z.array(text),
});

// The Preferences form's own rules, so a document holds what the form allows.
export const preferencesSettingsSchema = z.strictObject(preferencesSchema.shape);

export const accountsSettingsSchema = z.array(z.strictObject({
    id: nonEmpty,
    provider: z.enum(['manual', 'schwab', 'plaid']).optional(),
    name: nonEmpty,
    type: text,
    accountMask: text,
    holdings: nonNegative,
    // Negative for credit and loan accounts.
    accountValue: z.number(),
    // Shown as written, e.g. "Oct 19, 3:45 PM".
    lastSynced: text,
    status: z.enum(['reconciled', 'needs-review', 'error']),
    errorMessage: text.optional(),
    institutionId: text.optional(),
    institutionName: text.optional(),
    plaidAccountId: text.optional(),
    plaidItemId: text.optional(),
    capabilities: z.array(z.enum(PLAID_CAPABILITIES)).optional(),
    syncReady: flag.optional(),
    tokenStorageMode: z.enum(['memory', 'encrypted_file', 'postgres']).optional(),
    tokenStorageDurable: flag.optional(),
    providerItemStatus: z.enum(['active', 'missing-token', 'revoked', 'reconnected']).optional(),
}));

export const tagsSettingsSchema = z.array(z.strictObject({
    id: nonEmpty,
    name: nonEmpty,
    color: hexColor,
}));

// The bounds GuardrailsCard clamps to.
export const guardrailSettingsSchema = z.strictObject({
    approvalThresholdEnabled: flag,
    approvalThresholdUsd: whole(500, 10_000_000),
    concentrationCapEnabled: flag,
    concentrationCapPct: whole(5, 50),
    thesisLinkageRequired: flag,
});

export const executionSettingsSchema = z.strictObject({
    rationaleRequired: flag,
    cooldownSeconds: z.literal([0, 10, 30, 60]),
});

const bucketPolicySchema = z.strictObject({
    bucket: z.enum(POLICY_BUCKETS),
    targetPct: percent.optional(),
    minPct: percent.optional(),
    maxPct: percent.optional(),
});

const cashJobSchema = z.strictObject({
    id: nonEmpty,
    type: z.enum(CASH_JOB_TYPES),
    label: text,
    amount: nonNegative,
    targetAmount: nonNegative.optional(),
    monthlyExpenses: nonNegative.optional(),
    monthsTarget: nonNegative.optional(),
    reviewBy: calendarDate.optional(),
    destination: text.optional(),
});

const cashDeploymentRuleSchema = z.strictObject({
    enabled: flag,
    cadence: z.enum(['monthly', 'quarterly']),
    percentOfExcess: percent,
    destination: text,
    nextDueDate: calendarDate.optional(),
    lastAcknowledgedAt: timestamp.optional(),
    unassignedAcknowledgedUntil: calendarDate.optional(),
});

const employerStockPlanSchema = z.strictObject({
    id: nonEmpty,
    label: text,
    symbols: z.array(text),
    state: z.enum(EMPLOYER_STOCK_PLAN_STATES),
    targetAllocationPct: percent,
    intermediateTargetPct: percent,
    trimCadence: z.enum(EMPLOYER_STOCK_TRIM_CADENCES),
    trimMethod: z.enum(EMPLOYER_STOCK_TRIM_METHODS),
    trimAmountUsd: planUsd,
    trimPercentOfPosition: percent,
    defaultVestAction: z.enum(EMPLOYER_STOCK_VEST_ACTIONS),
    plannedVestValueUsd: planUsd,
    nextActionDate: calendarDate.optional(),
    nextVestDate: calendarDate.optional(),
    // POLICY_BUCKETS includes cash_reserve.
    destination: z.enum([...POLICY_BUCKETS, 'core_index', 'custom']),
    destinationLabel: text,
    taxReservePct: percent,
    maxTaxImpactUsd: nonNegative.optional(),
    accountLocation: z.enum(['taxable', 'retirement', 'mixed', 'unknown']).optional(),
});

const optionsRiskPolicySchema = z.strictObject({
    watchPositionPremiumPct: percent,
    maxPositionPremiumPct: percent,
    maxUnderlyingPremiumPct: percent,
    maxTotalPremiumPct: percent,
    maxLossBudgetPct: percent,
    expiryWarningDays: days,
    expiryClusterDays: days,
    expiryClusterMaxPremiumPct: percent,
});

const sellDisciplineRuleSchema = z.strictObject({
    id: nonEmpty,
    type: z.enum(SELL_DISCIPLINE_TRIGGER_TYPES),
    label: text,
    action: z.enum(['trim', 'recover_cost', 're_underwrite', 'exit', 'no_add', 'review']),
    state: z.enum(['active', 'triggered', 'snoozed', 'resolved']),
    symbol: text.optional(),
    thesisId: text.optional(),
    // A stale-thesis rule keeps its age in days here, so no upper bound.
    thresholdPct: nonNegative.optional(),
    targetPrice: nonNegative.optional(),
    targetAllocationPct: nonNegative.optional(),
    vestDate: calendarDate.optional(),
    noAdd: flag.optional(),
    snoozedUntil: timestamp.optional(),
    resolvedAt: timestamp.optional(),
    stateReason: text.optional(),
    lastTriggeredAt: timestamp.optional(),
    auditTrail: z.array(z.strictObject({
        id: nonEmpty,
        type: z.enum(['triggered', 'snoozed', 'resolved', 'reactivated']),
        reason: text,
        createdAt: timestamp,
    })).optional(),
});

// The bounds ChurnPolicyCard clamps to.
const churnPolicySchema = z.strictObject({
    windowDays: whole(14, 365),
    watchRepeatSymbols: whole(1, 25),
    breachRepeatSymbols: whole(1, 25),
});

export const riskPolicySettingsSchema = z.strictObject({
    bucketPolicies: z.array(bucketPolicySchema),
    themeCaps: z.partialRecord(z.enum(THEME_IDS), percent.optional()),
    cashJobs: z.array(cashJobSchema),
    cashDeploymentRule: cashDeploymentRuleSchema,
    employerStockPlan: employerStockPlanSchema,
    optionsRiskPolicy: optionsRiskPolicySchema,
    sellDisciplineRules: z.array(sellDisciplineRuleSchema),
    churnPolicy: churnPolicySchema,
});

export const demoSettingsSchema = z.strictObject({
    showSampleData: flag,
});

export const SETTINGS_SLICE_SCHEMAS = {
    profile: profileSettingsSchema,
    appearance: appearanceSettingsSchema,
    notifications: notificationSettingsSchema,
    alphaRadarDelivery: alphaRadarDeliverySettingsSchema,
    preferences: preferencesSettingsSchema,
    accounts: accountsSettingsSchema,
    tags: tagsSettingsSchema,
    guardrails: guardrailSettingsSchema,
    execution: executionSettingsSchema,
    riskPolicy: riskPolicySettingsSchema,
    demo: demoSettingsSchema,
} satisfies Record<PersistedSettingsSlice, z.ZodType>;

/** Every persisted slice, as the store holds them. */
export const persistedSettingsSchema = z.strictObject(SETTINGS_SLICE_SCHEMAS);

export type PersistedSettingsDocument = z.output<typeof persistedSettingsSchema>;

/** A document's settings: any slice may be left out (it keeps its defaults). */
const documentSettingsSchema = persistedSettingsSchema.partial();

// --- Saving ---------------------------------------------------------------

export interface SettingsIssue {
    path: PropertyKey[];
    /** Names the field, e.g. "settings.tags[0].color must be a hex colour such as #17cf54". */
    message: string;
}

/**
 * The first field of `settings` the app could not have written, or null. A
 * document from an older `version` may leave out fields added since and keep
 * fields removed since; every value it does hold must still be valid, and it
 * holds only persisted slices.
 */
export function findSettingsIssue(settings: unknown, version: number): SettingsIssue | null {
    const result = documentSettingsSchema.safeParse(settings);
    if (result.success) return null;
    const older = version < SETTINGS_VERSION;
    const issue = result.error.issues.find((candidate) => !(older && isVersionGap(settings, candidate)));
    if (!issue) return null;
    // An unknown key in a record names the record, as an unknown field does.
    const path = issue.code === 'invalid_key' ? issue.path.slice(0, -1) : issue.path;
    return { path: issue.path, message: `${formatSettingsPath(path)} ${describeIssue(issue, valueAt(settings, issue.path))}` };
}

function isVersionGap(settings: unknown, issue: z.core.$ZodIssue): boolean {
    if (issue.path.length === 0) return false;
    return issue.code === 'unrecognized_keys' || issue.code === 'invalid_key' || valueAt(settings, issue.path) === undefined;
}

/** "settings.riskPolicy.sellDisciplineRules[2].type", as the request body has it. */
function formatSettingsPath(path: readonly PropertyKey[]): string {
    return path.reduce<string>(
        (out, key) => (typeof key === 'number' ? `${out}[${key}]` : `${out}.${String(key)}`),
        'settings',
    );
}

const EXPECTED: Readonly<Record<string, string>> = {
    string: 'text',
    number: 'a number',
    int: 'a whole number',
    boolean: 'true or false',
    object: 'an object',
    array: 'a list',
};

function describeIssue(issue: z.core.$ZodIssue, value: unknown): string {
    if (issue.code === 'unrecognized_keys') return `has an unknown field ${issue.keys.map((key) => JSON.stringify(key)).join(', ')}`;
    if (issue.code === 'invalid_key') return `has an unknown field ${JSON.stringify(String(issue.path.at(-1)))}`;
    if (value === undefined) return 'is missing';
    if (issue.message.startsWith('must ')) return issue.message;
    switch (issue.code) {
        case 'invalid_type':
            return `must be ${EXPECTED[issue.expected] ?? issue.expected}`;
        case 'invalid_value':
            return `must be one of ${issue.values.map((option) => JSON.stringify(option)).join(', ')}`;
        case 'too_small':
            return issue.origin === 'string' ? 'must not be empty' : `must be at least ${String(issue.minimum)}`;
        case 'too_big':
            return `must be at most ${String(issue.maximum)}`;
        default:
            return issue.message;
    }
}

// --- Loading --------------------------------------------------------------

/**
 * Fallbacks for list items' required fields, keyed by the list's path. An
 * item missing any other required field (what identifies or names it: an
 * id, a name, a type) is dropped instead.
 */
const LIST_ITEM_FALLBACKS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    accounts: { type: '', accountMask: '', holdings: 0, accountValue: 0, lastSynced: '', status: 'needs-review' },
    // The first default tag's colour.
    tags: { color: '#17cf54' },
    'riskPolicy.cashJobs': { label: '', amount: 0 },
    'riskPolicy.sellDisciplineRules': { label: '' },
};

/** Each pass mends one level; documents are a handful of levels deep. */
const MAX_REPAIR_PASSES = 8;

/**
 * Makes stored settings safe to load, whatever they hold: every field the
 * app could not have written (missing, the wrong kind, out of range, not one
 * of the options) falls back to its value in `defaults`, or, for a list
 * item's field, to LIST_ITEM_FALLBACKS. Without a fallback, an optional field
 * goes, and a list item goes when it is the wrong kind or lacks a required
 * field. Unknown fields go. Slices not in `settings` stay out.
 */
export function sanitizeSettings(
    settings: Readonly<Record<string, unknown>>,
    defaults: PersistedSettingsDocument,
): Partial<PersistedSettingsDocument> {
    const repaired: Record<string, unknown> = structuredClone(settings);
    for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
        const result = documentSettingsSchema.safeParse(repaired);
        if (result.success) return result.data;
        repair(repaired, result.error.issues, defaults);
    }
    // Still invalid, which only a fallback that is itself invalid leaves: the
    // slice stays out, so the store keeps what it has.
    for (const slice of Object.keys(repaired)) {
        const schema: z.ZodType | undefined = SETTINGS_SLICE_SCHEMAS[slice as PersistedSettingsSlice];
        if (!schema?.safeParse(repaired[slice]).success) delete repaired[slice];
    }
    return repaired as Partial<PersistedSettingsDocument>;
}

type Path = readonly PropertyKey[];

function repair(root: Record<string, unknown>, issues: readonly z.core.$ZodIssue[], defaults: PersistedSettingsDocument): void {
    // Items are dropped last, highest index first, so the other paths still hold.
    const drops = new Map<unknown[], Set<number>>();
    const drop = (itemPath: Path) => {
        const list = valueAt(root, itemPath.slice(0, -1)) as unknown[];
        const indexes = drops.get(list) ?? new Set<number>();
        drops.set(list, indexes.add(itemPath.at(-1) as number));
    };

    for (const issue of issues) {
        const { path } = issue;
        if (issue.code === 'unrecognized_keys') {
            const target = valueAt(root, path) as Record<string, unknown>;
            for (const key of issue.keys) delete target[key];
            continue;
        }
        if (path.length === 0) continue;
        if (issue.code === 'invalid_key') {
            // An unknown key in a record, such as a theme cap for no theme.
            deleteAt(root, path);
            continue;
        }
        const fallback = fallbackFor(defaults, path);
        if (fallback !== undefined) {
            setAt(root, path, structuredClone(fallback));
        } else if (typeof path.at(-1) === 'number') {
            // A list item of the wrong kind.
            drop(path);
        } else if (valueAt(root, path) !== undefined) {
            // An optional field: it goes. A required one without a fallback
            // is missing on the next pass.
            deleteAt(root, path);
        } else {
            // A required field is missing: the list item it belongs to goes.
            const item = lastListIndex(path);
            if (item >= 0) drop(path.slice(0, item + 1));
            else setAt(root, path.slice(0, 1), structuredClone(defaults[path[0] as PersistedSettingsSlice]));
        }
    }

    for (const [list, indexes] of drops) {
        for (const index of [...indexes].sort((a, b) => b - a)) list.splice(index, 1);
    }
}

/** The fallback for the value at `path`: the default, or a list item field's. */
function fallbackFor(defaults: PersistedSettingsDocument, path: Path): unknown {
    const item = lastListIndex(path);
    if (item === -1) return valueAt(defaults, path);
    // Only a field of a list item has one: not the item itself, nor anything inside one of its fields.
    if (item !== path.length - 2) return undefined;
    return LIST_ITEM_FALLBACKS[path.slice(0, item).map(String).join('.')]?.[String(path[item + 1])];
}

function lastListIndex(path: Path): number {
    return path.findLastIndex((key) => typeof key === 'number');
}

function valueAt(root: unknown, path: Path): unknown {
    let node = root;
    for (const key of path) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<PropertyKey, unknown>)[key];
    }
    return node;
}

function setAt(root: Record<string, unknown>, path: Path, value: unknown): void {
    (valueAt(root, path.slice(0, -1)) as Record<PropertyKey, unknown>)[path.at(-1)!] = value;
}

function deleteAt(root: Record<string, unknown>, path: Path): void {
    delete (valueAt(root, path.slice(0, -1)) as Record<PropertyKey, unknown>)[path.at(-1)!];
}
