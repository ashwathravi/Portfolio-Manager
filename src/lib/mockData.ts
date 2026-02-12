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
