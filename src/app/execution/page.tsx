"use client"

import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrderEntryForm } from "@/components/execution/OrderEntryForm";
import { OrderBlotter } from "@/components/execution/OrderBlotter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Order } from "@/types/execution";

const initialWorkingOrders: Order[] = [
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
        updatedAt: new Date(),
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
        placedAt: new Date(Date.now() - 3600000),
        updatedAt: new Date(),
    },
]

const initialFilledOrders: Order[] = [
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
        placedAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
    },
]

export default function ExecutionPage() {
    const [workingOrders, setWorkingOrders] = useState<Order[]>(initialWorkingOrders)
    const [filledOrders] = useState<Order[]>(initialFilledOrders)
    const [cancelledOrders, setCancelledOrders] = useState<Order[]>([])

    const handleOrderPlaced = (order: Order) => {
        setWorkingOrders((prev) => [order, ...prev])
    }

    const handleCancelOrder = (id: string) => {
        setWorkingOrders((prev) => {
            const order = prev.find((o) => o.id === id)
            if (order) {
                setCancelledOrders((c) => [
                    { ...order, status: "cancelled", updatedAt: new Date() },
                    ...c,
                ])
            }
            return prev.filter((o) => o.id !== id)
        })
    }

    return (
        <AppShell>
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Left Column: Order Entry */}
                <div className="w-full lg:w-1/3">
                    <OrderEntryForm onOrderPlaced={handleOrderPlaced} />
                </div>

                {/* Right Column: Order Blotter */}
                <div className="w-full lg:w-2/3">
                    <div className="mb-6">
                        <h1 className="text-3xl font-bold tracking-tight">Execution</h1>
                        <p className="text-muted-foreground">Manage active orders and view trade history.</p>
                    </div>

                    <Tabs defaultValue="working" className="w-full">
                        <TabsList>
                            <TabsTrigger value="working">Working ({workingOrders.length})</TabsTrigger>
                            <TabsTrigger value="filled">Fills ({filledOrders.length})</TabsTrigger>
                            <TabsTrigger value="cancelled">Cancelled ({cancelledOrders.length})</TabsTrigger>
                        </TabsList>
                        <TabsContent value="working" className="mt-4">
                            <OrderBlotter orders={workingOrders} onCancel={handleCancelOrder} />
                        </TabsContent>
                        <TabsContent value="filled" className="mt-4">
                            <OrderBlotter orders={filledOrders} />
                        </TabsContent>
                        <TabsContent value="cancelled" className="mt-4">
                            <OrderBlotter orders={cancelledOrders} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </AppShell>
    );
}
