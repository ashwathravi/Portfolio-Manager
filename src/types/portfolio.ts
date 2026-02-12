export interface Portfolio {
    id: string;
    name: string;
    description?: string;
    totalValue: number;
    cashBalance: number;
    costBasis: number;
    unrealizedGain: number;
    unrealizedGainPercent: number;
    dayChange: number;
    dayChangePercent: number;
    accountCount: number;
    linkedAccounts: string[];
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date;
}

export interface Holding {
    id: string;
    portfolioId: string;
    ticker: string;
    securityName: string;
    quantity: number;
    currentPrice: number;
    marketValue: number;
    percentOfPortfolio: number;
    costBasis: number;
    costBasisPerShare: number;
    unrealizedGain: number;
    unrealizedGainPercent: number;
    dayChange: number;
    dayChangePercent: number;
    currency: string;
    accountId: string;  // Which account this holding is in
    priceChart: { date: Date; price: number }[];
    linkedThesis?: string;  // Thesis ID if applicable
}
