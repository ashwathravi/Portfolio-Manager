import { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownLeft, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';
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
    buy: 'text-blue-500 bg-blue-500/10',
    sell: 'text-primary bg-primary/10',
    dividend: 'text-purple-500 bg-purple-500/10',
    deposit: 'text-primary bg-primary/10',
    withdrawal: 'text-destructive bg-destructive/10',
} as const;

// Optimized: Moved formatters outside to avoid re-creation on every render.
const currencyFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

// Optimized: Moved formatters outside to avoid re-creation on every render.
const transactionDateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

// Optimized: Cache for formatted dates to avoid redundant parsing.
const dateCache = new Map<string, string>();

// Optimized: Uses Intl.DateTimeFormat for efficient and consistent date formatting.
// Format: "YYYY-MM-DD" -> "MMM D" (e.g., "Feb 5")
function formatTransactionDate(dateStr: string) {
    if (!dateStr) return '';

    const cached = dateCache.get(dateStr);
    if (cached) return cached;

    let result: string;
    const date = new Date(dateStr);

    if (isNaN(date.getTime())) {
        // Fallback to original string if date is invalid
        result = dateStr;
    } else {
        result = transactionDateFormatter.format(date);
    }

    dateCache.set(dateStr, result);
    return result;
}

// Optimized: Wrapped in React.memo to prevent unnecessary re-renders when parent state updates.
// The component iterates over a list of transactions, and memoization ensures this work is skipped unless props change.
export const ActivityFeed = memo(function ActivityFeed({ transactions, title = 'Recent Activity' }: ActivityFeedProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {transactions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <AlertCircle className="mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                        <p>No recent activity</p>
                    </div>
                ) : (
                    <ul className="space-y-4">
                        {transactions.map((transaction) => {
                            const Icon = transactionIcons[transaction.type];
                            const colorClass = transactionColors[transaction.type];

                            return (
                                <li
                                    key={transaction.id}
                                    className="flex items-start gap-4 rounded-lg p-2 transition-colors hover:bg-muted/50"
                                >
                                    <div className={cn('rounded-lg p-2', colorClass)}>
                                        <Icon className="h-4 w-4" aria-hidden="true" />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <p className="font-medium">
                                                {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
                                                {transaction.ticker && ` ${transaction.ticker}`}
                                            </p>
                                            <div
                                                className={cn(
                                                    'font-medium flex items-center gap-1',
                                                    transaction.amount > 0 ? 'text-primary' : 'text-destructive'
                                                )}
                                            >
                                                <span className="sr-only">
                                                    {transaction.amount > 0 ? 'Inflow of ' : 'Outflow of '}
                                                </span>
                                                <span aria-hidden="true">{transaction.amount > 0 ? '+' : '-'}</span>
                                                <span>
                                                    $
                                                    {currencyFormatter.format(Math.abs(transaction.amount))}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                                            <p>
                                                {transaction.quantity &&
                                                    `${transaction.quantity} shares @ $${transaction.price?.toFixed(2)}`}
                                                {transaction.notes && !transaction.quantity && transaction.notes}
                                            </p>
                                            <p>
                                                {formatTransactionDate(transaction.date)}
                                            </p>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
});
