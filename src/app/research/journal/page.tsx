"use client"

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { JournalEntry } from "@/types/research";

// Mock Data
const mockEntries: JournalEntry[] = [
    {
        id: "je_1",
        userId: "user_1",
        date: new Date("2024-02-05"),
        ticker: "TSLA",
        action: "sell",
        price: 182.50,
        rationale: "Price action failed to reclaim 200 DMA. Q1 delivery estimates are likely to be revised down further.",
        conviction: "medium",
        timeHorizon: "1-3 months",
        expectedOutcome: "Stock retests $150 support level.",
        tags: ["technical", "macro"],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "je_2",
        userId: "user_1",
        date: new Date("2024-01-15"),
        ticker: "NVDA",
        action: "buy",
        price: 545.00,
        rationale: "Breakout from 3-month consolidation base. AI infrastructure spend showing no signs of slowing down.",
        conviction: "high",
        timeHorizon: "6-12 months",
        expectedOutcome: "New breadth expansion to $700+.",
        tags: ["growth", "breakout"],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "je_3",
        userId: "user_1",
        date: new Date("2023-11-10"),
        ticker: "PLTR",
        action: "hold",
        price: 18.20,
        rationale: "Gov contracts providing steady floor, commercial growth accelerating. Waiting for clear signal.",
        conviction: "low",
        timeHorizon: "3-6 months",
        expectedOutcome: "Chop sideways until earnings.",
        tags: ["saas", "gov"],
        createdAt: new Date(),
        updatedAt: new Date(),
    }
];

export default function JournalPage() {
    return (
        <AppShell>
            <div className="flex items-center justify-between space-y-2 mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" asChild aria-label="Back to Research">
                        <Link href="/research"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
                    </Button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Decision Journal</h2>
                        <p className="text-muted-foreground">Log your trades and track your decision quality.</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        New Entry
                    </Button>
                </div>
            </div>

            <div className="flex gap-4 mb-6">
                <Select defaultValue="all">
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filter by Ticker" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Tickers</SelectItem>
                        <SelectItem value="nvda">NVDA</SelectItem>
                        <SelectItem value="tsla">TSLA</SelectItem>
                    </SelectContent>
                </Select>
                <Select defaultValue="all">
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Action" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Actions</SelectItem>
                        <SelectItem value="buy">Buy</SelectItem>
                        <SelectItem value="sell">Sell</SelectItem>
                        <SelectItem value="hold">Hold</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                {mockEntries.map((entry) => (
                    <div key={entry.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        {/* Icon */}
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-background bg-muted shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 text-muted-foreground">
                            {entry.action === 'buy' ? 'B' : entry.action === 'sell' ? 'S' : 'H'}
                        </div>

                        {/* Card */}
                        <Card className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h3 className="font-bold text-lg flex items-center gap-2">
                                        {entry.ticker}
                                        <Badge variant={entry.action === 'buy' ? 'success' : entry.action === 'sell' ? 'destructive' : 'secondary'} className="uppercase text-[10px]">
                                            {entry.action} @ ${entry.price?.toFixed(2)}
                                        </Badge>
                                    </h3>
                                    <time className="text-xs text-muted-foreground">{entry.date.toLocaleDateString()}</time>
                                </div>
                                <Badge variant="outline">{entry.conviction} conviction</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3">
                                {entry.rationale}
                            </p>
                            <div className="flex gap-2">
                                {entry.tags.map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0 h-5">#{tag}</Badge>
                                ))}
                            </div>
                        </Card>
                    </div>
                ))}
            </div>
        </AppShell>
    );
}
