"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Order, OrderSide, OrderType, TimeInForce } from "@/types/execution"
import { useSettingsStore } from "@/lib/stores/settingsStore"

interface OrderEntryFormProps {
    onOrderPlaced: (order: Order) => void
}

export function OrderEntryForm({ onOrderPlaced }: OrderEntryFormProps) {
    const [side, setSide] = useState<OrderSide>("buy")
    const [orderType, setOrderType] = useState<OrderType>("limit")
    const [ticker, setTicker] = useState("")
    const [quantity, setQuantity] = useState("")
    const [price, setPrice] = useState("")
    const [tif, setTif] = useState<TimeInForce>("day")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const apiKey = useSettingsStore((s) => s.security.apiKey)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const newOrder: Order = {
            id: crypto.randomUUID(),
            portfolioId: "p1",
            ticker,
            side,
            type: orderType,
            quantity: Number(quantity),
            limitPrice: orderType !== "market" ? Number(price) : undefined,
            status: "working",
            filledQuantity: 0,
            timeInForce: tif,
            placedAt: new Date(),
            updatedAt: new Date(),
        }

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/schwab/order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey || ''
                },
                body: JSON.stringify({ order: newOrder })
            });

            if (!res.ok) {
                throw new Error('Failed to submit order to broker');
            }

            onOrderPlaced(newOrder)

            toast.success(
                `${side === "buy" ? "Buy" : "Sell"} order placed`,
                {
                    description: `${quantity} × ${ticker} @ ${orderType === "market" ? "MKT" : `$${Number(price).toFixed(2)}`}`,
                }
            )

            setTicker("")
            setQuantity("")
            setPrice("")
        } catch (error) {
            toast.error('Order submission failed', {
                description: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    const isBuy = side === "buy"

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle>Order Entry</CardTitle>
                <CardDescription>Place manual trade orders to the broker.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">

                    <Tabs value={side} onValueChange={(v) => setSide(v as OrderSide)} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger
                                value="buy"
                                className="data-[state=active]:bg-green-600 data-[state=active]:text-white"
                            >
                                Buy
                            </TabsTrigger>
                            <TabsTrigger
                                value="sell"
                                className="data-[state=active]:bg-red-600 data-[state=active]:text-white"
                            >
                                Sell
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="ticker">Symbol</Label>
                            <Input
                                id="ticker"
                                placeholder="e.g. AAPL"
                                value={ticker}
                                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="type">Order Type</Label>
                            <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
                                <SelectTrigger id="type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="market">Market</SelectItem>
                                    <SelectItem value="limit">Limit</SelectItem>
                                    <SelectItem value="stop">Stop</SelectItem>
                                    <SelectItem value="stop_limit">Stop Limit</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="quantity">Quantity</Label>
                            <Input
                                id="quantity"
                                type="number"
                                min="1"
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                required
                            />
                        </div>
                        {orderType !== 'market' && (
                            <div className="space-y-2">
                                <Label htmlFor="price">Price</Label>
                                <Input
                                    id="price"
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    required
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="tif">Time in Force</Label>
                        <Select value={tif} onValueChange={(v) => setTif(v as TimeInForce)}>
                            <SelectTrigger id="tif">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="day">Day</SelectItem>
                                <SelectItem value="gtc">GTC (Good Till Cancel)</SelectItem>
                                <SelectItem value="ioc">IOC (Immediate or Cancel)</SelectItem>
                                <SelectItem value="fok">FOK (Fill or Kill)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        type="submit"
                        disabled={isSubmitting}
                        className={`w-full text-white ${isBuy ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"} ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                        {isSubmitting ? "Submitting..." : `${isBuy ? "Buy" : "Sell"} ${ticker || "Stock"}`}
                    </Button>

                </form>
            </CardContent>
        </Card>
    )
}
