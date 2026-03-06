import { z } from 'zod';
import { safeText } from './common';
import { tickerSchema } from './market-data';

export const orderSideSchema = z.enum(['buy', 'sell']);
export const orderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop_limit']);
export const timeInForceSchema = z.enum(['day', 'gtc', 'ioc', 'fok']);

export const orderSchema = z.object({
    ticker: tickerSchema,
    side: orderSideSchema,
    type: orderTypeSchema,
    quantity: z.preprocess(
        (val) => Number(val),
        z.number()
            .int("Quantity must be a whole number")
            .positive("Quantity must be positive")
            .max(1_000_000, "Quantity exceeds limit")
    ),
    limitPrice: z.preprocess(
        (val) => (val === "" || val === undefined ? undefined : Number(val)),
        z.number().positive("Price must be positive").optional()
    ),
    stopPrice: z.preprocess(
        (val) => (val === "" || val === undefined ? undefined : Number(val)),
        z.number().positive("Price must be positive").optional()
    ),
    timeInForce: timeInForceSchema,
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
});

export type OrderFormValues = z.infer<typeof orderSchema>;
