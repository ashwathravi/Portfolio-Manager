export interface Thesis {
    id: string;
    userId: string;
    ticker: string;
    securityName: string;
    title: string;
    hypothesis: string;
    conviction: 'high' | 'medium' | 'low';
    timeHorizon: string;
    status: 'active' | 'tested' | 'abandoned' | 'archived';
    evidenceForText: string;
    evidenceAgainstText: string;
    risksText: string;
    catalystsList: Catalyst[];
    priceTargets: {
        bull: number;
        base: number;
        bear: number;
        targetDate?: Date;
    };
    linkedEvidence: Evidence[];
    linkedTrades: string[];  // Trade IDs
    linkedJournalEntries: string[];
    healthScore: number;  // 0-100
    createdAt: Date;
    updatedAt: Date;
    lastReviewDate?: Date;
}

export interface Catalyst {
    id: string;
    date: Date;
    dateEnd?: Date;
    description: string;
    probability?: number;  // 0-1
    impact?: 'high' | 'medium' | 'low';
    occurred?: boolean;
    outcomeNotes?: string;
}

export interface Evidence {
    id: string;
    thesisId: string;
    type: 'article' | 'transcript' | 'chart' | 'data' | 'custom';
    title: string;
    source: string;
    url?: string;
    content?: string;
    datePublished?: Date;
    dateAdded: Date;
    summary?: string;
    sentiment?: 'bullish' | 'neutral' | 'bearish';
}

export interface Watchlist {
    id: string;
    userId: string;
    name: string;
    description?: string;
    tickers: WatchlistItem[];
    createdAt: Date;
    updatedAt: Date;
}

export interface WatchlistItem {
    ticker: string;
    priceTarget?: number;
    priceTargetReason?: string;
    alertPrice?: number;
    linkedThesis?: string;
    dateAdded: Date;
    notes?: string;
}

export interface JournalEntry {
    id: string;
    userId: string;
    date: Date;
    ticker: string;
    action: 'buy' | 'sell' | 'hold';
    price?: number;
    rationale: string;
    conviction: 'high' | 'medium' | 'low';
    timeHorizon: string;
    expectedOutcome: string;
    linkedThesis?: string;
    linkedTrade?: string;
    tags: string[];
    outcome?: {
        actualReturn: number;
        result: 'correct' | 'incorrect' | 'partial';
        reviewedAt: Date;
        reflection: string;
        lessonsLearned: string;
    };
    reviewDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}
