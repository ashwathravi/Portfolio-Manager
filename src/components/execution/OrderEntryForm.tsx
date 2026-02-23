"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderSide, OrderType, TimeInForce } from "@/types/execution"
import { orderSchema, type OrderFormValues } from "@/lib/validators/execution"
import { toast } from "sonner"

export function OrderEntryForm() {
    const {
        register,
        control,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<OrderFormValues>({
        // @ts-expect-error - Resolver type mismatch due to z.preprocess in schema
        resolver: zodResolver(orderSchema),
        defaultValues: {
            side: "buy",
            type: "limit",
            timeInForce: "day",
            ticker: "",
            quantity: undefined,
            limitPrice: undefined,
            stopPrice: undefined,
        },
    })

    const side = watch("side")
    const orderType = watch("type")
    const ticker = watch("ticker")

    const onSubmit = (data: OrderFormValues) => {
        // Mock submission - in real app would call API
        console.log("Order Submitted:", data)
        toast.success(`Order Submitted: ${data.side.toUpperCase()} ${data.quantity} shares of ${data.ticker}`)
        reset({
            side: data.side, // Keep the side
            type: "limit",
            timeInForce: "day",
            ticker: "",
            quantity: undefined,
            limitPrice: undefined,
            stopPrice: undefined,
        })
    }

    return (
        <Card className="w-full border-border shadow-sm">
            <CardHeader>
                <CardTitle>Order Entry</CardTitle>
                <CardDescription>Place manual trade orders to the broker.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">

                    <Controller
                        control={control}
                        name="side"
                        render={({ field }) => (
                            <Tabs value={field.value} onValueChange={(v) => field.onChange(v as OrderSide)} className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="buy" className="data-[state=active]:bg-success-600 data-[state=active]:text-white">Buy</TabsTrigger>
                                    <TabsTrigger value="sell" className="data-[state=active]:bg-danger-600 data-[state=active]:text-white">Sell</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="ticker">Symbol</Label>
                            <Input
                                id="ticker"
                                placeholder="e.g. AAPL"
                                {...register("ticker")}
                                onChange={(e) => setValue("ticker", e.target.value.toUpperCase(), { shouldValidate: true })}
                                aria-invalid={!!errors.ticker}
                                aria-describedby={errors.ticker ? "ticker-error" : undefined}
                            />
                            {errors.ticker && (
                                <p id="ticker-error" className="text-sm text-destructive">{errors.ticker.message}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="type">Order Type</Label>
                            <Controller
                                control={control}
                                name="type"
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={(v) => field.onChange(v as OrderType)}>
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
                                )}
                            />
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
                                {...register("quantity")}
                                aria-invalid={!!errors.quantity}
                                aria-describedby={errors.quantity ? "quantity-error" : undefined}
                            />
                            {errors.quantity && (
                                <p id="quantity-error" className="text-sm text-destructive">{errors.quantity.message}</p>
                            )}
                        </div>

                        {(orderType === 'limit' || orderType === 'stop_limit') && (
                            <div className="space-y-2">
                                <Label htmlFor="limitPrice">Limit Price</Label>
                                <Input
                                    id="limitPrice"
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    {...register("limitPrice")}
                                    aria-invalid={!!errors.limitPrice}
                                    aria-describedby={errors.limitPrice ? "limitPrice-error" : undefined}
                                />
                                {errors.limitPrice && (
                                    <p id="limitPrice-error" className="text-sm text-destructive">{errors.limitPrice.message}</p>
                                )}
                            </div>
                        )}

                        {(orderType === 'stop' || orderType === 'stop_limit') && (
                            <div className="space-y-2">
                                <Label htmlFor="stopPrice">Stop Price</Label>
                                <Input
                                    id="stopPrice"
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    {...register("stopPrice")}
                                    aria-invalid={!!errors.stopPrice}
                                    aria-describedby={errors.stopPrice ? "stopPrice-error" : undefined}
                                />
                                {errors.stopPrice && (
                                    <p id="stopPrice-error" className="text-sm text-destructive">{errors.stopPrice.message}</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="tif">Time in Force</Label>
                         <Controller
                            control={control}
                            name="timeInForce"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={(v) => field.onChange(v as TimeInForce)}>
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
                            )}
                        />
                    </div>

                    <Button type="submit" disabled={isSubmitting} className={`w-full ${side === 'buy' ? 'bg-success-600 hover:bg-success-700' : 'bg-danger-600 hover:bg-danger-700'}`}>
                        {side === 'buy' ? 'Buy' : 'Sell'} {ticker || 'Stock'}
                    </Button>

                </form>
            </CardContent>
        </Card>
    )
}
