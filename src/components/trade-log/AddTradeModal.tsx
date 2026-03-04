'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface TradeFormData {
    date: string;
    symbol: string;
    name: string;
    type: 'BUY' | 'SELL';
    quantity: string;
    price: string;
    account: string;
    strategy: string;
}

const today = new Date().toISOString().split('T')[0];

const defaultForm: TradeFormData = {
    date: today,
    symbol: '',
    name: '',
    type: 'BUY',
    quantity: '',
    price: '',
    account: 'Fidelity Individual',
    strategy: '',
};

interface AddTradeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (trade: {
        date: string;
        symbol: string;
        name: string;
        type: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        totalValue: number;
        account: string;
        status: 'completed';
        strategy: string;
        tags: string[];
    }) => void;
}

export function AddTradeModal({ open, onOpenChange, onSubmit }: AddTradeModalProps) {
    const [form, setForm] = useState<TradeFormData>(defaultForm);

    const set = (field: keyof TradeFormData) => (value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const handleSubmit = () => {
        if (!form.symbol || !form.quantity || !form.price) {
            toast.error('Please fill in ticker, quantity, and price.');
            return;
        }
        const qty = parseFloat(form.quantity);
        const price = parseFloat(form.price);
        onSubmit({
            date: form.date,
            symbol: form.symbol.toUpperCase(),
            name: form.name || form.symbol.toUpperCase(),
            type: form.type,
            quantity: qty,
            price,
            totalValue: qty * price,
            account: form.account,
            status: 'completed',
            strategy: form.strategy,
            tags: [],
        });
        setForm({ ...defaultForm, date: today });
        onOpenChange(false);
        toast.success(`${form.type} ${form.symbol.toUpperCase()} logged.`);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Log Trade</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Ticker *</label>
                            <Input
                                placeholder="AAPL"
                                value={form.symbol}
                                onChange={(e) => set('symbol')(e.target.value.toUpperCase())}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Company Name</label>
                            <Input
                                placeholder="Apple Inc."
                                value={form.name}
                                onChange={(e) => set('name')(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Side</label>
                            <Select value={form.type} onValueChange={set('type')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="BUY">Buy</SelectItem>
                                    <SelectItem value="SELL">Sell</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Quantity *</label>
                            <Input
                                type="number"
                                placeholder="100"
                                value={form.quantity}
                                onChange={(e) => set('quantity')(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Price *</label>
                            <Input
                                type="number"
                                placeholder="175.00"
                                value={form.price}
                                onChange={(e) => set('price')(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Account</label>
                            <Select value={form.account} onValueChange={set('account')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Fidelity Individual">Fidelity Individual</SelectItem>
                                    <SelectItem value="Fidelity Roth IRA">Fidelity Roth IRA</SelectItem>
                                    <SelectItem value="TD Ameritrade">TD Ameritrade</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Date</label>
                            <Input
                                type="date"
                                value={form.date}
                                onChange={(e) => set('date')(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Strategy</label>
                        <Input
                            placeholder="e.g. Growth Tech"
                            value={form.strategy}
                            onChange={(e) => set('strategy')(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>Log Trade</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
