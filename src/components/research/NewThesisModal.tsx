'use client';

import { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Thesis, ThesisDraft } from '@/lib/research/thesis';

interface ThesisFormData {
    ticker: string;
    companyName: string;
    title: string;
    description: string;
    type: 'bull' | 'bear';
    conviction: 'HIGH' | 'MEDIUM' | 'LOW';
    targetPrice: string;
    timeHorizon: string;
}

const defaultForm: ThesisFormData = {
    ticker: '',
    companyName: '',
    title: '',
    description: '',
    type: 'bull',
    conviction: 'MEDIUM',
    targetPrice: '',
    timeHorizon: '12 months',
};

function toFormData(thesis: Thesis): ThesisFormData {
    return {
        ticker: thesis.ticker,
        companyName: thesis.companyName,
        title: thesis.title,
        description: thesis.description,
        type: thesis.type,
        conviction: thesis.conviction,
        targetPrice: String(thesis.targetPrice),
        timeHorizon: thesis.timeHorizon,
    };
}

interface NewThesisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (thesis: ThesisDraft) => void;
    /** When provided, the modal operates in edit mode and pre-fills fields. */
    editing?: Thesis | null;
}

export function NewThesisModal({ open, onOpenChange, onSubmit, editing }: NewThesisModalProps) {
    const [form, setForm] = useState<ThesisFormData>(defaultForm);

    // Reset the form when the modal opens so edits and creates don't bleed into each other.
    useEffect(() => {
        if (!open) return;
        setForm(editing ? toFormData(editing) : defaultForm);
    }, [open, editing]);

    const set = (field: keyof ThesisFormData) => (value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const handleSubmit = () => {
        if (!form.ticker || !form.companyName || !form.title || !form.targetPrice) {
            toast.error('Please fill in all required fields.');
            return;
        }
        const ticker = form.ticker.toUpperCase();
        onSubmit({
            ticker,
            companyName: form.companyName,
            title: form.title,
            description: form.description,
            type: form.type,
            conviction: form.conviction,
            targetPrice: parseFloat(form.targetPrice),
            timeHorizon: form.timeHorizon,
        });
        setForm(defaultForm);
        onOpenChange(false);
        toast.success(editing ? `Thesis for ${ticker} updated.` : `Thesis for ${ticker} created.`);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{editing ? 'Edit Investment Thesis' : 'New Investment Thesis'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Ticker *</label>
                            <Input
                                placeholder="AAPL"
                                value={form.ticker}
                                onChange={(e) => set('ticker')(e.target.value.toUpperCase())}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Company Name *</label>
                            <Input
                                placeholder="Apple Inc."
                                value={form.companyName}
                                onChange={(e) => set('companyName')(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Thesis Title *</label>
                        <Input
                            placeholder="e.g. AI-Driven Services Acceleration"
                            value={form.title}
                            onChange={(e) => set('title')(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Direction</label>
                            <Select value={form.type} onValueChange={set('type')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="bull">Bull</SelectItem>
                                    <SelectItem value="bear">Bear</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Conviction</label>
                            <Select value={form.conviction} onValueChange={set('conviction')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="HIGH">High</SelectItem>
                                    <SelectItem value="MEDIUM">Medium</SelectItem>
                                    <SelectItem value="LOW">Low</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Target Price *</label>
                            <Input
                                type="number"
                                placeholder="250"
                                value={form.targetPrice}
                                onChange={(e) => set('targetPrice')(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Time Horizon</label>
                            <Input
                                placeholder="12 months"
                                value={form.timeHorizon}
                                onChange={(e) => set('timeHorizon')(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Description</label>
                        <Textarea
                            placeholder="Summarise your thesis..."
                            value={form.description}
                            onChange={(e) => set('description')(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>{editing ? 'Save Changes' : 'Create Thesis'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
