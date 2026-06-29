import { z } from 'zod';
import { tickerSchema } from './market-data';

export const orderSideSchema = z.enum(['buy', 'sell']);
export const orderInstrumentTypeSchema = z.enum(['equity', 'option']);
export const orderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop_limit']);
export const timeInForceSchema = z.enum(['day', 'gtc', 'ioc', 'fok']);
export const optionContractTypeSchema = z.enum(['call', 'put']);

const optionalPositiveNumberSchema = z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : Number(val)),
    z.number().positive("Price must be positive").optional()
);

export const orderSchema = z.object({
    ticker: tickerSchema,
    instrumentType: orderInstrumentTypeSchema.optional().default('equity'),
    side: orderSideSchema,
    type: orderTypeSchema,
    quantity: z.preprocess(
        (val) => Number(val),
        z.number()
            .int("Quantity must be a whole number")
            .positive("Quantity must be positive")
            .max(1_000_000, "Quantity exceeds limit")
    ),
    limitPrice: optionalPositiveNumberSchema,
    stopPrice: optionalPositiveNumberSchema,
    timeInForce: timeInForceSchema,
    optionContractType: optionContractTypeSchema.optional(),
    optionStrike: optionalPositiveNumberSchema,
    optionExpiry: z.string().optional(),
    optionPremium: optionalPositiveNumberSchema,
    linkedThesisId: z.string().trim().optional(),
    maxLossAcknowledged: z.boolean().optional(),
    whatMustBeTrueByExpiry: z.string().trim().optional(),
    plannedExitRule: z.string().trim().optional(),
}).superRefine((data, ctx) => {
    // Limit price required for limit and stop_limit orders
    if ((data.type === 'limit' || data.type === 'stop_limit') && !data.limitPrice) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Limit price is required for this order type",
            path: ["limitPrice"],
        });
    }

    // Stop price required for stop and stop_limit orders
    if ((data.type === 'stop' || data.type === 'stop_limit') && !data.stopPrice) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Stop price is required for this order type",
            path: ["stopPrice"],
        });
    }

    if (data.instrumentType !== 'option') return;

    if (data.side === 'sell') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Short option orders require a separate undefined-risk workflow",
            path: ["side"],
        });
    }

    if (!data.optionContractType) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Option contract type is required",
            path: ["optionContractType"],
        });
    }

    if (!data.optionStrike) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Option strike is required",
            path: ["optionStrike"],
        });
    }

    if (!data.optionPremium) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Option premium is required",
            path: ["optionPremium"],
        });
    }

    const expiry = data.optionExpiry?.trim();
    if (!expiry) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Option expiry is required",
            path: ["optionExpiry"],
        });
    } else {
        const expiryDate = new Date(`${expiry.slice(0, 10)}T00:00:00.000Z`);
        if (Number.isNaN(expiryDate.getTime())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Option expiry must be a valid date",
                path: ["optionExpiry"],
            });
        }
    }

    if (!data.linkedThesisId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Options require a linked thesis",
            path: ["linkedThesisId"],
        });
    }

    if (data.maxLossAcknowledged !== true) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Options require max-loss acknowledgement",
            path: ["maxLossAcknowledged"],
        });
    }

    if (!data.whatMustBeTrueByExpiry) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Define what must be true by expiry",
            path: ["whatMustBeTrueByExpiry"],
        });
    }

    if (!data.plannedExitRule) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Define the exit, roll, or expire rule",
            path: ["plannedExitRule"],
        });
    }
});

export type OrderFormValues = z.infer<typeof orderSchema>;
