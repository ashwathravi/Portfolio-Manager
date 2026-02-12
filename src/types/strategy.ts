export interface Strategy {
    id: string;
    userId: string;
    name: string;
    description: string;
    status: 'draft' | 'backtesting' | 'paper' | 'live' | 'archived';
    universe: {
        type: 'static' | 'dynamic';
        assets?: string[]; // List of tickers
        rules?: string[]; // e.g. "S&P 500 constituents"
    };
    entryRules: Rule[];
    exitRules: Rule[];
    positionSizing: {
        type: 'fixed_amount' | 'percent_equity' | 'risk_parity';
        value: number;
    };
    rebalancing: {
        frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
        threshold?: number;
    };
    createdAt: Date;
    updatedAt: Date;
    lastBacktestId?: string;
}

export interface Rule {
    id: string;
    type: 'indicator' | 'pattern' | 'fundamental' | 'time' | 'custom';
    indicator?: string; // e.g. "RSI"
    operator: '>' | '<' | '==' | '>=' | '<=' | 'crosses_above' | 'crosses_below';
    value: number | string;
    period?: number; // e.g. 14 for RSI
    logic?: 'AND' | 'OR'; // For chaining
}

export interface BacktestResult {
    id: string;
    strategyId: string;
    status: 'running' | 'completed' | 'failed';
    startDate: Date;
    endDate: Date;
    initialCapital: number;
    finalCapital: number;
    totalReturn: number;
    totalReturnPercent: number;
    cagr: number;
    metrics: {
        sharpeRatio: number;
        sortinoRatio: number;
        maxDrawdown: number;
        maxDrawdownDuration: number; // days
        winRate: number;
        profitFactor: number;
        beta: number;
        alpha: number;
        volatility: number;
    };
    trades: Trade[];
    equityCurve: { date: Date; equity: number; drawdown: number }[];
    robustness?: {
        monteCarloProbDrawdown: number; // e.g. 0.95
        regimeAnalysis: {
            bullMarketReturn: number;
            bearMarketReturn: number;
            highVolReturn: number;
        };
    };
    runDate: Date;
}

export interface Trade {
    id: string;
    backtestId: string;
    ticker: string;
    entryDate: Date;
    exitDate: Date;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    direction: 'long' | 'short';
    pnl: number;
    pnlPercent: number;
    entryReason: string;
    exitReason: string;
    fees: number;
}
