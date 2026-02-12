import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
    title: string;
    value: string;
    change?: number;
    changeLabel?: string;
    trend?: 'up' | 'down' | 'neutral';
    subtitle?: string;
    icon?: React.ReactNode;
    className?: string;
}

export function StatCard({
    title,
    value,
    change,
    changeLabel,
    trend,
    subtitle,
    icon,
    className,
}: StatCardProps) {
    const isPositive = trend === 'up' || (change !== undefined && change > 0);
    const isNegative = trend === 'down' || (change !== undefined && change < 0);

    return (
        <Card className={cn('p-6 relative overflow-hidden group border-border hover:border-primary/30 transition-colors', className)}>
            {icon && (
                <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <div className="text-6xl text-foreground">{icon}</div>
                </div>
            )}
            <div className="relative">
                <div className="flex items-start justify-between mb-4">
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>
                    {icon && (
                        <div className="rounded-lg bg-primary/10 p-2 text-primary">
                            <div className="w-5 h-5">{icon}</div>
                        </div>
                    )}
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                    <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
                </div>
                {change !== undefined && (
                    <div className="flex items-center gap-2 mt-auto">
                        <span
                            className={cn(
                                'flex items-center gap-1 text-xs font-bold px-2 py-1 rounded',
                                isPositive && 'text-primary bg-primary/10',
                                isNegative && 'text-destructive bg-destructive/10',
                                !isPositive && !isNegative && 'text-muted-foreground bg-muted'
                            )}
                        >
                            {isPositive && <TrendingUp className="h-3 w-3" />}
                            {isNegative && <TrendingDown className="h-3 w-3" />}
                            {isPositive ? '+' : ''}{Math.abs(change).toFixed(2)}%
                        </span>
                        {(changeLabel || subtitle) && (
                            <span className="text-xs text-muted-foreground">
                                {changeLabel || subtitle}
                            </span>
                        )}
                    </div>
                )}
                {!change && (changeLabel || subtitle) && (
                    <p className="text-xs text-muted-foreground mt-2">
                        {changeLabel || subtitle}
                    </p>
                )}
            </div>
        </Card>
    );
}
