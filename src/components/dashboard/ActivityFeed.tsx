import { Card } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownLeft, DollarSign, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Transaction } from '@/lib/mockData';

interface ActivityFeedProps {
    transactions: Transaction[];
    title?: string;
}

const transactionIcons = {
    buy: ArrowDownLeft,
    sell: ArrowUpRight,
    dividend: DollarSign,
    deposit: TrendingUp,
    withdrawal: ArrowDownLeft,
} as const;

const transactionColors = {
    buy: 'text-blue-600 bg-blue-100',
    sell: 'text-green-600 bg-green-100',
    dividend: 'text-purple-600 bg-purple-100',
    deposit: 'text-green-600 bg-green-100',
    withdrawal: 'text-red-600 bg-red-100',
} as const;

export function ActivityFeed({ transactions, title = 'Recent Activity' }: ActivityFeedProps) {
    return (
        <Card className="p-6">
            <h3 className="mb-4 font-semibold">{title}</h3>
            <div className="space-y-4">
                {transactions.map((transaction) => {
                    const Icon = transactionIcons[transaction.type];
                    const colorClass = transactionColors[transaction.type];

                    return (
                        <div key={transaction.id} className="flex items-start gap-4">
                            <div className={cn('rounded-lg p-2', colorClass)}>
                                <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 space-y-1">
                                <div className="flex items-center justify-between">
                                    <p className="font-medium">
                                        {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
                                        {transaction.ticker && ` ${transaction.ticker}`}
                                    </p>
                                    <p
                                        className={cn(
                                            'font-medium',
                                            transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                                        )}
                                    >
                                        {transaction.amount > 0 ? '+' : ''}$
                                        {Math.abs(transaction.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="flex items-center justify-between text-sm text-muted-foreground">
                                    <p>
                                        {transaction.quantity && `${transaction.quantity} shares @ $${transaction.price?.toFixed(2)}`}
                                        {transaction.notes && !transaction.quantity && transaction.notes}
                                    </p>
                                    <p>{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}
