import { z } from 'zod';
import { safeText } from './common';

export const profileSchema = z.object({
    fullName: z.string().min(2, "Name must be at least 2 characters").max(100, "Name is too long").pipe(safeText),
    email: z.string().email("Please enter a valid email address").max(255, "Email is too long"),
    phone: z.string().min(10, "Phone number must be at least 10 characters").max(20, "Phone number is too long").pipe(safeText),
});

export const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required").max(100, "Password is too long"),
    newPassword: z.string()
        .min(12, "Password must be at least 12 characters")
        .max(100, "Password is too long")
        .regex(/[A-Z]/, "Must contain at least one uppercase letter")
        .regex(/[a-z]/, "Must contain at least one lowercase letter")
        .regex(/[0-9]/, "Must contain at least one number")
        .regex(/[^A-Za-z0-9]/, "Must contain at least one special character"),
    confirmPassword: z.string().min(1, "Please confirm your password").max(100, "Password is too long"),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

export const tagSchema = z.object({
    name: z.string().trim().min(1, "Tag name is required").max(30, "Tag name is too long").pipe(safeText),
    color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a valid hex color"),
});

// API key: allow blank (cleared) or a reasonable token length.
// Most providers use alphanumeric + a few special characters.
export const apiKeySchema = z.string()
    .trim()
    .max(256, "API key is too long")
    .regex(/^[A-Za-z0-9_.\-]*$/, "API key contains invalid characters");

export const preferencesSchema = z.object({
    baseCurrency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR']),
    dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
    numberFormat: z.enum(['en-US', 'en-GB', 'de-DE', 'fr-FR']),
    defaultLandingPage: z.enum(['/', '/performance', '/analytics', '/portfolios', '/research', '/strategies']),
    marketDataRefreshSeconds: z.number().int().min(15, "Minimum 15 seconds").max(3600, "Maximum 60 minutes"),
});

export const alertRuleSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(60, "Name is too long").pipe(safeText),
    metric: z.enum([
        'price',
        'price_change_pct',
        'portfolio_value',
        'portfolio_day_change_pct',
        'alpha_radar_new_position',
        'alpha_radar_exit',
        'alpha_radar_large_add',
        'alpha_radar_large_trim',
        'alpha_radar_user_overlap',
    ]),
    symbol: z.string().trim().toUpperCase().max(10, "Symbol is too long").regex(/^[A-Z.\-]*$/, "Invalid symbol").optional().or(z.literal('')),
    comparator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
    threshold: z.number().finite(),
    enabled: z.boolean(),
    rearm: z.enum(['once', 'always', 'daily']),
    note: z.string().trim().max(200, "Note is too long").optional().or(z.literal('')),
}).superRefine((data, ctx) => {
    const needsSymbol = data.metric === 'price' || data.metric === 'price_change_pct';
    const isAlphaRadarMetric = data.metric.startsWith('alpha_radar_');
    if (needsSymbol && !data.symbol) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Symbol is required for this metric",
            path: ['symbol'],
        });
    }
    if (isAlphaRadarMetric && (data.threshold < 0 || data.threshold > 100)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Alpha Radar materiality score must be between 0 and 100",
            path: ['threshold'],
        });
    }
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
export type TagFormValues = z.infer<typeof tagSchema>;
export type PreferencesFormValues = z.infer<typeof preferencesSchema>;
export type AlertRuleFormValues = z.infer<typeof alertRuleSchema>;
