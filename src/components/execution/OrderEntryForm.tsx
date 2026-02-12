"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderSide, OrderType, TimeInForce } from "@/types/execution"

export function OrderEntryForm() {
    const [side, setSide] = useState<OrderSide>("buy")
    const [orderType, setOrderType] = useState<OrderType>("limit")
    const [ticker, setTicker] = useState("")
    const [quantity, setQuantity] = useState("")
    const [price, setPrice] = useState("")

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        // Mock submission - in real app would call API
        console.log("Order Submitted:", { side, orderType, ticker, quantity, price })
        alert(`Order Submitted: ${side.toUpperCase()} ${quantity} shares of ${ticker} @ ${orderType === 'market' ? 'MKT' : price}`)
        setTicker("")
        setQuantity("")
        setPrice("")
    }

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
                            <TabsTrigger value="buy" className="data-[state=active]:bg-success-600 data-[state=active]:text-white">Buy</TabsTrigger>
                            <TabsTrigger value="sell" className="data-[state=active]:bg-danger-600 data-[state=active]:text-white">Sell</TabsTrigger>
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
                        <Select defaultValue="day">
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

                    <Button type="submit" className={`w-full ${side === 'buy' ? 'bg-success-600 hover:bg-success-700' : 'bg-danger-600 hover:bg-danger-700'}`}>
                        {side === 'buy' ? 'Buy' : 'Sell'} {ticker || 'Stock'}
                    </Button>

                </form>
            </CardContent>
        </Card>
    )
}
