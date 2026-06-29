import type {
    OptionContractType,
    PreTradeRiskPolicyImpact,
    RiskPolicyException,
} from '@/lib/risk-policy';
import type { TradeRationale } from './trade';

export type OrderSide = 'buy' | 'sell';
export type OrderInstrumentType = 'equity' | 'option';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'pending' | 'working' | 'filled' | 'cancelled' | 'rejected';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

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

export interface Order {
    id: string;
    portfolioId: string;
    strategyId?: string; // Optional linking to a strategy
    instrumentType?: OrderInstrumentType;
    ticker: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    limitPrice?: number;
    stopPrice?: number;
    status: OrderStatus;
    filledQuantity: number;
    averageFillPrice?: number;
    timeInForce: TimeInForce;
    placedAt: Date;
    updatedAt: Date;
    /**
     * Pre-trade rationale captured at submit (AR-109). Optional because
     * legacy orders predate this feature and the settings toggle may
     * disable the capture flow. When present, surfaces in the blotter
     * and journal read this verbatim — never synthesize one after the
     * fact.
    */
    rationale?: TradeRationale;
    optionDetails?: OrderOptionDetails;
    riskPolicyImpact?: PreTradeRiskPolicyImpact;
    policyExceptions?: RiskPolicyException[];
    riskPolicyOverrideReason?: string;
}

export interface Execution {
    id: string;
    orderId: string;
    ticker: string;
    side: OrderSide;
    quantity: number;
    price: number;
    executedAt: Date;
    fees: number;
    venue?: string; // e.g., "NYSE", "IEX"
}
