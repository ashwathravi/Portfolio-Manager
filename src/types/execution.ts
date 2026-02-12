export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'pending' | 'working' | 'filled' | 'cancelled' | 'rejected';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export interface Order {
    id: string;
    portfolioId: string;
    strategyId?: string; // Optional linking to a strategy
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
