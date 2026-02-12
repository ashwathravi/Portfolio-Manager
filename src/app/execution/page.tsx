"use client"

import { AppShell } from "@/components/layout/AppShell";
import { OrderEntryForm } from "@/components/execution/OrderEntryForm";
import { OrderBlotter } from "@/components/execution/OrderBlotter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Order } from "@/types/execution";

// Mock Data
const workingOrders: Order[] = [
    {
        id: "o1",
        portfolioId: "p1",
        ticker: "TSLA",
        side: "buy",
        type: "limit",
        quantity: 50,
        limitPrice: 200.50,
        status: "working",
        filledQuantity: 0,
        timeInForce: "day",
        placedAt: new Date(),
        updatedAt: new Date()
    },
    {
        id: "o2",
        portfolioId: "p1",
        ticker: "AAPL",
        side: "sell",
        type: "stop",
        quantity: 100,
        stopPrice: 175.00,
        status: "working",
        filledQuantity: 0,
        timeInForce: "gtc",
        placedAt: new Date(Date.now() - 3600000), // 1 hour ago
        updatedAt: new Date()
    }
]

const filledOrders: Order[] = [
    {
        id: "o3",
        portfolioId: "p1",
        ticker: "MSFT",
        side: "buy",
        type: "market",
        quantity: 25,
        status: "filled",
        filledQuantity: 25,
        averageFillPrice: 380.20,
        timeInForce: "ioc",
        placedAt: new Date(Date.now() - 86400000), // 1 day ago
        updatedAt: new Date()
    }
]

export default function ExecutionPage() {
    return (
        <AppShell>
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Left Column: Order Entry */}
                <div className="w-full lg:w-1/3">
                    <OrderEntryForm />
                </div>

                {/* Right Column: Order Blotter */}
                <div className="w-full lg:w-2/3">
                    <div className="mb-6">
                        <h2 className="text-3xl font-bold tracking-tight">Execution</h2>
                        <p className="text-muted-foreground">Manage active orders and view trade history.</p>
                    </div>

                    <Tabs defaultValue="working" className="w-full">
                        <TabsList>
                            <TabsTrigger value="working">Working ({workingOrders.length})</TabsTrigger>
                            <TabsTrigger value="filled">Fills</TabsTrigger>
                            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
                        </TabsList>
                        <TabsContent value="working" className="mt-4">
                            <OrderBlotter orders={workingOrders} />
                        </TabsContent>
                        <TabsContent value="filled" className="mt-4">
                            <OrderBlotter orders={filledOrders} />
                        </TabsContent>
                        <TabsContent value="cancelled" className="mt-4">
                            <div className="p-4 text-center text-muted-foreground border rounded-md">
                                No cancelled orders.
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </AppShell>
    );
}
