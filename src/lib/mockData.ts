export interface Portfolio {
    id: string;
    name: string;
    description: string;
    totalValue: number;
    cashBalance: number;
    returnPercent: number;
    returnDollar: number;
    todayChange: number;
    todayChangePercent: number;
    holdings: Holding[];
}

export interface Holding {
    id: string;
    ticker: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    totalReturn: number;
    totalReturnPercent: number;
    todayChange: number;
    todayChangePercent: number;
    allocation: number;
}

export interface Transaction {
    id: string;
    date: string;
    type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal';
    ticker?: string;
    quantity?: number;
    price?: number;
    amount: number;
    notes?: string;
}

export interface PerformanceMetric {
    period: string;
    return: number;
    benchmark: number;
    alpha: number;
    sharpe: number;
    maxDrawdown: number;
}

// Mock portfolios
export const mockPortfolios: Portfolio[] = [
    {
        id: 'main',
        name: 'Main Portfolio',
        description: 'Long-term growth portfolio',
        totalValue: 487250.32,
        cashBalance: 12450.00,
        returnPercent: 18.45,
        returnDollar: 76234.12,
        todayChange: 3425.67,
        todayChangePercent: 0.71,
        holdings: [
            {
                id: '1',
                ticker: 'AAPL',
                name: 'Apple Inc.',
                quantity: 500,
                avgCost: 165.30,
                currentPrice: 182.45,
                marketValue: 91225.00,
                totalReturn: 8575.00,
                totalReturnPercent: 10.38,
                todayChange: 625.00,
                todayChangePercent: 0.69,
                allocation: 18.7,
            },
            {
                id: '2',
                ticker: 'MSFT',
                name: 'Microsoft Corporation',
                quantity: 300,
                avgCost: 325.80,
                currentPrice: 378.25,
                marketValue: 113475.00,
                totalReturn: 15735.00,
                totalReturnPercent: 16.09,
                todayChange: 1125.00,
                todayChangePercent: 1.00,
                allocation: 23.3,
            },
            {
                id: '3',
                ticker: 'NVDA',
                name: 'NVIDIA Corporation',
                quantity: 200,
                avgCost: 425.50,
                currentPrice: 512.80,
                marketValue: 102560.00,
                totalReturn: 17460.00,
                totalReturnPercent: 20.52,
                todayChange: 820.00,
                todayChangePercent: 0.81,
                allocation: 21.1,
            },
            {
                id: '4',
                ticker: 'GOOGL',
                name: 'Alphabet Inc.',
                quantity: 400,
                avgCost: 128.90,
                currentPrice: 141.25,
                marketValue: 56500.00,
                totalReturn: 4940.00,
                totalReturnPercent: 9.58,
                todayChange: 280.00,
                todayChangePercent: 0.50,
                allocation: 11.6,
            },
            {
                id: '5',
                ticker: 'TSLA',
                name: 'Tesla, Inc.',
                quantity: 250,
                avgCost: 205.40,
                currentPrice: 248.75,
                marketValue: 62187.50,
                totalReturn: 10837.50,
                totalReturnPercent: 21.12,
                todayChange: 575.00,
                todayChangePercent: 0.93,
                allocation: 12.8,
            },
            {
                id: '6',
                ticker: 'AMZN',
                name: 'Amazon.com Inc.',
                quantity: 350,
                avgCost: 142.30,
                currentPrice: 165.90,
                marketValue: 58065.00,
                totalReturn: 8260.00,
                totalReturnPercent: 16.59,
                todayChange: -175.00,
                todayChangePercent: -0.30,
                allocation: 11.9,
            },
        ],
    },
    {
        id: 'growth',
        name: 'Growth Portfolio',
        description: 'High-growth technology stocks',
        totalValue: 152340.50,
        cashBalance: 5240.00,
        returnPercent: 24.32,
        returnDollar: 29754.32,
        todayChange: 1240.25,
        todayChangePercent: 0.82,
        holdings: [],
    },
    {
        id: 'dividend',
        name: 'Dividend Income',
        description: 'Dividend-focused investments',
        totalValue: 98765.25,
        cashBalance: 3120.00,
        returnPercent: 12.15,
        returnDollar: 10698.45,
        todayChange: -234.50,
        todayChangePercent: -0.24,
        holdings: [],
    },
];

// Mock transactions
export const mockTransactions: Transaction[] = [
    {
        id: '1',
        date: '2026-02-05',
        type: 'buy',
        ticker: 'AAPL',
        quantity: 50,
        price: 182.45,
        amount: -9122.50,
        notes: 'Adding to position',
    },
    {
        id: '2',
        date: '2026-02-03',
        type: 'sell',
        ticker: 'TSLA',
        quantity: 25,
        price: 248.75,
        amount: 6218.75,
        notes: 'Taking profits',
    },
    {
        id: '3',
        date: '2026-02-01',
        type: 'dividend',
        ticker: 'AAPL',
        amount: 115.00,
        notes: 'Quarterly dividend',
    },
    {
        id: '4',
        date: '2026-01-28',
        type: 'buy',
        ticker: 'NVDA',
        quantity: 20,
        price: 512.80,
        amount: -10256.00,
        notes: 'Opening position',
    },
    {
        id: '5',
        date: '2026-01-25',
        type: 'deposit',
        amount: 10000.00,
        notes: 'Monthly contribution',
    },
];

// Mock performance data
export const mockPerformanceMetrics: PerformanceMetric[] = [
    {
        period: '1M',
        return: 4.32,
        benchmark: 3.15,
        alpha: 1.17,
        sharpe: 1.85,
        maxDrawdown: -2.34,
    },
    {
        period: '3M',
        return: 12.45,
        benchmark: 9.32,
        alpha: 3.13,
        sharpe: 1.92,
        maxDrawdown: -5.67,
    },
    {
        period: '6M',
        return: 18.45,
        benchmark: 14.23,
        alpha: 4.22,
        sharpe: 1.78,
        maxDrawdown: -8.45,
    },
    {
        period: 'YTD',
        return: 5.12,
        benchmark: 4.23,
        alpha: 0.89,
        sharpe: 1.65,
        maxDrawdown: -3.21,
    },
    {
        period: '1Y',
        return: 24.67,
        benchmark: 18.92,
        alpha: 5.75,
        sharpe: 1.88,
        maxDrawdown: -12.34,
    },
];

// Mock equity curve data
export const mockEquityCurve = Array.from({ length: 180 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (180 - i));
    const baseValue = 400000;
    const trend = i * 450;
    const volatility = Math.sin(i / 10) * 8000 + Math.random() * 5000;
    return {
        date: date.toISOString().split('T')[0],
        portfolio: baseValue + trend + volatility,
        benchmark: baseValue + i * 380 + Math.sin(i / 12) * 6000,
    };
});

export interface StrategyDetailData {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'paused' | 'backtesting';
    backtestPeriod: string;
    initialCapital: number;
    finalValue: number;
    netProfit: number;
    netProfitPercent: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    alpha: number;
    sortino: number;
    totalTrades: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    equityCurve: Array<{
        date: string;
        portfolio: number;
        benchmark: number;
    }>;
    monteCarloResults: Array<{
        percentile: string;
        finalValue: number;
        cagr: number;
    }>;
    regimeAnalysis: Array<{
        regime: string;
        returns: number;
        sharpe: number;
        trades: number;
    }>;
}

export const mockStrategyData: Record<string, StrategyDetailData> = {
    '1': {
        id: '1',
        name: 'Momentum + Value',
        description: 'Long positions in stocks with strong momentum and low P/E ratios',
        status: 'active',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 164500,
        netProfit: 64500,
        netProfitPercent: 64.5,
        sharpeRatio: 1.92,
        maxDrawdown: -18.4,
        winRate: 64.5,
        alpha: 8.2,
        sortino: 2.45,
        totalTrades: 127,
        avgWin: 3850,
        avgLoss: -1920,
        profitFactor: 2.15,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 88500, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 105200, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 112800, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 121500, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 128900, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 135400, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 142100, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 138200, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 132800, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 128600, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 134500, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 142300, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 149800, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 155600, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 158900, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 162400, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 164500, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 185200, cagr: 16.8 },
            { percentile: '75th', finalValue: 172400, cagr: 14.5 },
            { percentile: '50th (Median)', finalValue: 164500, cagr: 13.2 },
            { percentile: '25th', finalValue: 155800, cagr: 11.6 },
            { percentile: '5th', finalValue: 142300, cagr: 9.2 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 22.4, sharpe: 2.15, trades: 52 },
            { regime: 'Bear Market', returns: -8.2, sharpe: 1.12, trades: 28 },
            { regime: 'Sideways', returns: 6.8, sharpe: 1.65, trades: 47 },
        ],
    },
    '2': {
        id: '2',
        name: 'Mean Reversion',
        description: 'Short-term trades on oversold conditions with RSI < 30',
        status: 'paused',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 149200,
        netProfit: 49200,
        netProfitPercent: 49.2,
        sharpeRatio: 1.45,
        maxDrawdown: -22.6,
        winRate: 58.2,
        alpha: 5.8,
        sortino: 1.92,
        totalTrades: 203,
        avgWin: 2820,
        avgLoss: -2140,
        profitFactor: 1.68,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 92300, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 102800, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 108500, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 115200, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 120600, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 125800, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 131200, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 128400, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 122800, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 119500, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 124800, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 131600, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 137900, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 142500, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 145800, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 148200, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 149200, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 168400, cagr: 14.2 },
            { percentile: '75th', finalValue: 158200, cagr: 12.5 },
            { percentile: '50th (Median)', finalValue: 149200, cagr: 11.1 },
            { percentile: '25th', finalValue: 141500, cagr: 9.5 },
            { percentile: '5th', finalValue: 128600, cagr: 6.8 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 18.6, sharpe: 1.85, trades: 78 },
            { regime: 'Bear Market', returns: -5.4, sharpe: 0.92, trades: 52 },
            { regime: 'Sideways', returns: 8.2, sharpe: 1.42, trades: 73 },
        ],
    },
    '3': {
        id: '3',
        name: 'Sector Rotation',
        description: 'Monthly rotation based on relative strength indicators',
        status: 'backtesting',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 156800,
        netProfit: 56800,
        netProfitPercent: 56.8,
        sharpeRatio: 1.68,
        maxDrawdown: -16.2,
        winRate: 61.4,
        alpha: 7.2,
        sortino: 2.18,
        totalTrades: 88,
        avgWin: 4250,
        avgLoss: -2380,
        profitFactor: 1.95,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 90200, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 104500, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 110800, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 118200, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 124600, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 130200, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 136800, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 133400, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 128200, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 125600, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 130500, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 137800, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 144200, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 149600, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 153200, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 155800, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 156800, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 178600, cagr: 15.8 },
            { percentile: '75th', finalValue: 166400, cagr: 13.6 },
            { percentile: '50th (Median)', finalValue: 156800, cagr: 12.2 },
            { percentile: '25th', finalValue: 148500, cagr: 10.5 },
            { percentile: '5th', finalValue: 135200, cagr: 7.9 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 20.5, sharpe: 2.05, trades: 36 },
            { regime: 'Bear Market', returns: -6.8, sharpe: 1.05, trades: 22 },
            { regime: 'Sideways', returns: 7.5, sharpe: 1.58, trades: 30 },
        ],
    },
};
