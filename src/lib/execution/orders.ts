/**
 * Order plans in the database (launch item i53): saving one the user
 * drafted on Trade, moving it along (approve, mark placed, cancel), and
 * reading them back for the blotter. Every write checks the plan or its
 * account belongs to the user, whose ID the API routes take from the
 * session.
 */

import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { orderPlans, portfolios } from "@/db/schema";
import { buildLockUserAccountsQuery } from "@/lib/portfolio/manage";
import { AccountNotFoundError } from "@/lib/portfolio/transactionsWrite";
import { ORDER_PLAN_LIMITS, type OrderPlanCreate } from "@/lib/validators/order-plan";
import type { Order, OrderInstrumentType, OrderOptionDetails, OrderPolicyRecord, OrderSide, OrderStatus, OrderType, TimeInForce } from "@/types/execution";
import type { TradeRationale } from "@/types/trade";

import { ORDER_STATUS_SOURCES, type OrderStatusChange } from "./order-status";

type Database = typeof db;
type OrderPlanRow = typeof orderPlans.$inferSelect;

const OPEN_STATUSES: OrderStatus[] = ["pending_approval", "ready"];

/** How many placed and cancelled plans the blotter shows, newest first; open ones are always shown. */
export const CLOSED_ORDER_PLANS_SHOWN = 100;

export class OrderPlanLimitError extends Error {
    constructor() {
        super(`At most ${ORDER_PLAN_LIMITS.perUser} order plans`);
        this.name = "OrderPlanLimitError";
    }
}

/** The plan isn't where the change can start from (it was placed or cancelled meanwhile). */
export class OrderStatusConflictError extends Error {
    constructor(readonly order: Order) {
        super(`The order plan is ${order.status}`);
        this.name = "OrderStatusConflictError";
    }
}

const num = (value: string | null): number | undefined => (value === null ? undefined : Number(value));

export function orderFromRow(row: OrderPlanRow): Order {
    return {
        id: row.id,
        portfolioId: row.portfolioId,
        instrumentType: row.instrumentType as OrderInstrumentType,
        ticker: row.symbol,
        side: row.side as OrderSide,
        type: row.orderType as OrderType,
        quantity: Number(row.quantity),
        ...(row.limitPrice !== null ? { limitPrice: num(row.limitPrice) } : {}),
        ...(row.stopPrice !== null ? { stopPrice: num(row.stopPrice) } : {}),
        timeInForce: row.timeInForce as TimeInForce,
        status: row.status as OrderStatus,
        ...(row.referencePrice !== null ? { referencePrice: row.referencePrice } : {}),
        ...(row.referencePriceDate !== null ? { referencePriceDate: row.referencePriceDate } : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        // Validated when they were saved (src/lib/validators/order-plan.ts).
        ...(row.rationale ? { rationale: row.rationale as TradeRationale } : {}),
        ...(row.optionDetails ? { optionDetails: row.optionDetails as OrderOptionDetails } : {}),
        ...(row.policy ? { policy: row.policy as OrderPolicyRecord } : {}),
    };
}

/** The user's open plans, and their latest placed and cancelled ones. */
export function buildUserOrderPlansQueries(userId: string, database: Pick<Database, "select"> = db) {
    const mine = eq(orderPlans.userId, userId);
    return {
        open: database.select().from(orderPlans)
            .where(and(mine, inArray(orderPlans.status, OPEN_STATUSES)))
            .orderBy(desc(orderPlans.createdAt), asc(orderPlans.id)),
        closed: database.select().from(orderPlans)
            .where(and(mine, notInArray(orderPlans.status, OPEN_STATUSES)))
            .orderBy(desc(orderPlans.createdAt), asc(orderPlans.id))
            .limit(CLOSED_ORDER_PLANS_SHOWN),
    };
}

export async function loadUserOrderPlans(userId: string, database: Pick<Database, "select"> = db): Promise<Order[]> {
    const queries = buildUserOrderPlansQueries(userId, database);
    const [open, closed] = await Promise.all([queries.open, queries.closed]);
    return [...open, ...closed]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(orderFromRow);
}

/**
 * Saves a plan for one of the user's accounts: waiting for their approval
 * when the ticket said it's over their threshold, else ready to place.
 * Under the user's account lock, so it can't land in an account (or for a
 * user) being deleted.
 */
export async function createOrderPlan(userId: string, plan: OrderPlanCreate, database: Database = db): Promise<Order> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        const [owned] = await tx
            .select({ id: portfolios.id })
            .from(portfolios)
            .where(and(eq(portfolios.id, plan.portfolioId), eq(portfolios.userId, userId)))
            .limit(1);
        if (!owned) throw new AccountNotFoundError();
        const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(orderPlans)
            .where(eq(orderPlans.userId, userId));
        if (count >= ORDER_PLAN_LIMITS.perUser) throw new OrderPlanLimitError();

        const [row] = await tx
            .insert(orderPlans)
            .values({
                userId,
                portfolioId: plan.portfolioId,
                instrumentType: plan.instrumentType,
                symbol: plan.ticker,
                side: plan.side,
                orderType: plan.type,
                quantity: String(plan.quantity),
                limitPrice: plan.limitPrice != null ? String(plan.limitPrice) : null,
                stopPrice: plan.stopPrice != null ? String(plan.stopPrice) : null,
                timeInForce: plan.timeInForce,
                status: plan.needsApproval ? "pending_approval" : "ready",
                referencePrice: plan.referencePrice ?? null,
                referencePriceDate: plan.referencePriceDate ?? null,
                rationale: plan.rationale ?? null,
                optionDetails: plan.optionDetails ?? null,
                policy: plan.policy ?? null,
            })
            .returning();
        return orderFromRow(row);
    });
}

/**
 * Moves one of the user's plans to `to`, if it's where that change starts
 * from. Asking again for the status it already has answers it as it is (a
 * retried click). Null when the user has no such plan.
 */
export async function changeOrderPlanStatus(
    userId: string,
    id: string,
    to: OrderStatusChange,
    database: Pick<Database, "select" | "update"> = db,
    now: Date = new Date(),
): Promise<Order | null> {
    const mine = and(eq(orderPlans.id, id), eq(orderPlans.userId, userId));
    const [updated] = await database
        .update(orderPlans)
        .set({ status: to, updatedAt: now })
        .where(and(mine, inArray(orderPlans.status, [...ORDER_STATUS_SOURCES[to]])))
        .returning();
    if (updated) return orderFromRow(updated);

    const [current] = await database.select().from(orderPlans).where(mine).limit(1);
    if (!current) return null;
    const order = orderFromRow(current);
    if (order.status === to) return order;
    throw new OrderStatusConflictError(order);
}
