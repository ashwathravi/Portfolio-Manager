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
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type {
    JournalDecisionType,
    JournalDraft,
    JournalEntry,
    JournalOutcome,
} from '@/lib/research/journal';
import type { Thesis } from '@/lib/research/thesis';

interface JournalFormData {
    date: string;
    type: JournalDecisionType;
    ticker: string;
    decision: string;
    rationale: string;
    outcome: JournalOutcome;
    thesisId: string; // "" means no thesis linked
}

const NO_THESIS = '__none__';

function defaultForm(): JournalFormData {
    return {
        date: new Date().toISOString().split('T')[0],
        type: 'entry',
        ticker: '',
        decision: '',
        rationale: '',
        outcome: 'pending',
        thesisId: '',
    };
}

function toFormData(entry: JournalEntry): JournalFormData {
    return {
        date: entry.date,
        type: entry.type,
        ticker: entry.ticker,
        decision: entry.decision,
        rationale: entry.rationale,
        outcome: entry.outcome,
        thesisId: entry.thesisId ?? '',
    };
}

interface NewJournalEntryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (draft: JournalDraft) => void;
    /** When provided, the modal operates in edit mode. */
    editing?: JournalEntry | null;
    /** Active + archived theses to offer in the linked-thesis dropdown. */
    theses: readonly Thesis[];
}

export function NewJournalEntryModal({
    open,
    onOpenChange,
    onSubmit,
    editing,
    theses,
}: NewJournalEntryModalProps) {
    const [form, setForm] = useState<JournalFormData>(defaultForm);

    useEffect(() => {
        if (!open) return;
        // Reset modal draft on open so edit/create state does not bleed.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm(editing ? toFormData(editing) : defaultForm());
    }, [open, editing]);

    const set = <K extends keyof JournalFormData>(field: K) => (value: JournalFormData[K]) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const handleThesisChange = (value: string) => {
        if (value === NO_THESIS) {
            setForm((prev) => ({ ...prev, thesisId: '' }));
            return;
        }
        const match = theses.find((t) => t.id === value);
        setForm((prev) => ({
            ...prev,
            thesisId: value,
            ticker: match ? match.ticker : prev.ticker,
        }));
    };

    const handleSubmit = () => {
        if (!form.ticker.trim() || !form.decision.trim() || !form.rationale.trim()) {
            toast.error('Ticker, decision, and rationale are required.');
            return;
        }
        onSubmit({
            date: form.date,
            type: form.type,
            ticker: form.ticker,
            decision: form.decision,
            rationale: form.rationale,
            outcome: form.outcome,
            thesisId: form.thesisId || undefined,
        });
        onOpenChange(false);
        toast.success(editing ? 'Journal entry updated.' : 'Journal entry added.');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{editing ? 'Edit Journal Entry' : 'New Journal Entry'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Date *</label>
                            <Input
                                type="date"
                                value={form.date}
                                onChange={(e) => set('date')(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Decision Type</label>
                            <Select
                                value={form.type}
                                onValueChange={(value: JournalDecisionType) => set('type')(value)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="entry">Entry</SelectItem>
                                    <SelectItem value="exit">Exit</SelectItem>
                                    <SelectItem value="hold">Hold</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

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
                            <label className="text-sm font-medium">Linked Thesis</label>
                            <Select
                                value={form.thesisId || NO_THESIS}
                                onValueChange={handleThesisChange}
                            >
                                <SelectTrigger aria-label="Linked thesis">
                                    <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_THESIS}>None</SelectItem>
                                    {theses.map((thesis) => (
                                        <SelectItem key={thesis.id} value={thesis.id}>
                                            {thesis.ticker} — {thesis.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Decision *</label>
                        <Input
                            placeholder="e.g. Opened position with 20 shares"
                            value={form.decision}
                            onChange={(e) => set('decision')(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Rationale *</label>
                        <Textarea
                            placeholder="Why are you making this decision?"
                            value={form.rationale}
                            onChange={(e) => set('rationale')(e.target.value)}
                            rows={4}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium">Outcome</label>
                        <Select
                            value={form.outcome}
                            onValueChange={(value: JournalOutcome) => set('outcome')(value)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="win">Win</SelectItem>
                                <SelectItem value="loss">Loss</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>{editing ? 'Save Changes' : 'Add Entry'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
