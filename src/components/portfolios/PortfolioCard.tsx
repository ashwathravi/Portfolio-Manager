import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Portfolio } from '@/lib/mockData';

interface PortfolioCardProps {
    portfolio: Portfolio;
    onClick?: () => void;
}

export function PortfolioCard({ portfolio, onClick }: PortfolioCardProps) {
    const isPositive = portfolio.todayChangePercent > 0;

    return (
        <Card
            className={cn(
                'group cursor-pointer p-6 transition-all hover:shadow-lg border-border hover:border-primary/40',
                onClick && 'active:scale-[0.98]'
            )}
            onClick={onClick}
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
                                    <TrendingUp className="h-3 w-3" />
                                ) : (
                                    <TrendingDown className="h-3 w-3" />
                                )}
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
}
