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
import type { EvidenceType, ThesisEvidence } from '@/lib/research/thesis';

interface AddEvidenceModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (evidence: Omit<ThesisEvidence, 'id'>) => void;
}

const defaults = { title: '', type: 'note' as EvidenceType, date: '', url: '' };

export function AddEvidenceModal({ open, onOpenChange, onSubmit }: AddEvidenceModalProps) {
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
        onSubmit({
            title: form.title.trim(),
            type: form.type,
            date: form.date.trim(),
            url: form.url.trim() || undefined,
        });
        onOpenChange(false);
        toast.success('Evidence linked.');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Link Evidence</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Title *</label>
                        <Input
                            placeholder="e.g. Q3 Earnings Transcript"
                            value={form.title}
                            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Type</label>
                            <Select
                                value={form.type}
                                onValueChange={(value: EvidenceType) =>
                                    setForm((p) => ({ ...p, type: value }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="article">Article</SelectItem>
                                    <SelectItem value="report">Report</SelectItem>
                                    <SelectItem value="earnings">Earnings</SelectItem>
                                    <SelectItem value="note">Note</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Date *</label>
                            <Input
                                placeholder="2026-04-01"
                                value={form.date}
                                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Source URL</label>
                        <Input
                            placeholder="https://..."
                            value={form.url}
                            onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>Link Evidence</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
