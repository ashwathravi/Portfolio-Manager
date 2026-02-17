import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Portfolio } from '@/lib/mockData';
import { KeyboardEvent } from 'react';

interface PortfolioCardProps {
    portfolio: Portfolio;
    onClick?: () => void;
}

// Optimized: Wrapped in React.memo to prevent unnecessary re-renders when parent state updates.
// This component is used in a list in Dashboard, which updates frequently on user interaction.
export const PortfolioCard = memo(function PortfolioCard({ portfolio, onClick }: PortfolioCardProps) {
    const isPositive = portfolio.todayChangePercent > 0;

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
        }
    };

    return (
        <Card
            className={cn(
                'group cursor-pointer p-6 transition-all hover:shadow-lg border-border hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                onClick && 'active:scale-[0.98]'
            )}
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? handleKeyDown : undefined}
            aria-label={onClick ? `View ${portfolio.name} portfolio details` : undefined}
        >
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h3 className="font-bold text-lg mb-1 group-hover:text-primary transition-colors">{portfolio.name}</h3>
                        <p className="text-sm text-muted-foreground">
                            {portfolio.description}
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Value</p>
                        <p className="text-3xl font-bold tracking-tight">
                            ${portfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>

                    <div className="pt-3 border-t border-border grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Today</p>
                            <div
                                className={cn(
                                    'flex items-center gap-1 text-sm font-bold',
                                    isPositive ? 'text-primary' : 'text-destructive'
                                )}
                            >
                                {isPositive ? (
                                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                                ) : (
                                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                                )}
                                <span className="sr-only">{isPositive ? 'Up by ' : 'Down by '}</span>
                                {isPositive ? '+' : ''}{portfolio.todayChangePercent.toFixed(2)}%
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                ${Math.abs(portfolio.todayChange).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Total Return</p>
                            <div
                                className={cn(
                                    'text-sm font-bold',
                                    portfolio.returnPercent > 0 ? 'text-primary' : 'text-destructive'
                                )}
                            >
                                <span className="sr-only">{portfolio.returnPercent > 0 ? 'Up by ' : 'Down by '}</span>
                                {portfolio.returnPercent > 0 ? '+' : ''}{portfolio.returnPercent.toFixed(2)}%
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                ${portfolio.returnDollar.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
});
