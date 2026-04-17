'use client';

import { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
import type { CatalystImpact, ThesisCatalyst } from '@/lib/research/thesis';

interface AddCatalystModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (catalyst: Omit<ThesisCatalyst, 'id'>) => void;
}

const defaults = { title: '', date: '', impact: 'medium' as CatalystImpact };

export function AddCatalystModal({ open, onOpenChange, onSubmit }: AddCatalystModalProps) {
    const [form, setForm] = useState(defaults);

    useEffect(() => {
        if (!open) return;
        setForm(defaults);
    }, [open]);

    const handleSubmit = () => {
        if (!form.title.trim() || !form.date.trim()) {
            toast.error('Title and date are required.');
            return;
        }
        onSubmit({ title: form.title.trim(), date: form.date.trim(), impact: form.impact });
        onOpenChange(false);
        toast.success('Catalyst added.');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Catalyst</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Title *</label>
                        <Input
                            placeholder="e.g. Q4 Earnings"
                            value={form.title}
                            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Date *</label>
                        <Input
                            placeholder="2026-05-01 or Q2 2026"
                            value={form.date}
                            onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Impact</label>
                        <Select
                            value={form.impact}
                            onValueChange={(value: CatalystImpact) =>
                                setForm((p) => ({ ...p, impact: value }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>Add Catalyst</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
