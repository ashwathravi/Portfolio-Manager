import type {
    OptionContractType,
    PreTradeRiskPolicyDecision,
    RiskPolicyException,
} from '@/lib/risk-policy';
import type { TradeRationale } from './trade';

export type OrderSide = 'buy' | 'sell';
export type OrderInstrumentType = 'equity' | 'option';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

/**
 * Where an order plan stands (launch item i53). Atlas never routes an
 * order: a plan above the user's approval threshold waits for their
 * approval, then it's ready for them to place at their broker, and they
 * mark it placed (or cancel it).
 */
export type OrderStatus = 'pending_approval' | 'ready' | 'placed' | 'cancelled';

export const ORDER_STATUSES: readonly OrderStatus[] = ['pending_approval', 'ready', 'placed', 'cancelled'];

export interface OrderOptionDetails {
    underlying: string;
    contractType: OptionContractType;
    strike: number;
    expiry: string;
    premium: number;
    contractMultiplier: number;
    premiumAtRisk: number;
    notionalEquivalent: number;
    maxLossAcknowledged: boolean;
    whatMustBeTrueByExpiry: string;
    plannedExitRule: string;
}

/**
 * What the risk policy said when the plan was saved: its verdict, and the
 * rules the user chose to override, with their reason.
 */
export interface OrderPolicyRecord {
    decision: PreTradeRiskPolicyDecision;
    summary: string;
    exceptions: RiskPolicyException[];
    overrideReason?: string;
}

/** An order plan, as the server stores it and the blotter shows it. */
export interface Order {
    id: string;
    /** The account it's for. */
    portfolioId: string;
    instrumentType: OrderInstrumentType;
    /** The ticker, or an option's underlying. */
    ticker: string;
    side: OrderSide;
    type: OrderType;
    /** Shares, or option contracts. */
    quantity: number;
    limitPrice?: number;
    stopPrice?: number;
    timeInForce: TimeInForce;
    status: OrderStatus;
    /**
     * The price the ticket sized the plan at (a share's last close or
     * stored price, or an option's premium), and that close's date when it
     * was one.
     */
    referencePrice?: number;
    referencePriceDate?: string;
    /** ISO timestamps. */
    createdAt: string;
    updatedAt: string;
    /**
     * Pre-trade rationale captured at submit (AR-109), read-only after.
     * Absent when the settings toggle turned the capture off — never
     * synthesize one after the fact.
     */
    rationale?: TradeRationale;
    optionDetails?: OrderOptionDetails;
    policy?: OrderPolicyRecord;
}

/** What the ticket sends to save a plan; the server adds the rest. */
export type OrderPlanInput = Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
    /** Above the user's approval threshold: the plan waits for their approval. */
    needsApproval: boolean;
};
