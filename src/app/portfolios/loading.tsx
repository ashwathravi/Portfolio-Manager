import { Skeleton } from '@/components/ui/skeleton';

export default function PortfoliosLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-80" />
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-3">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
            </div>

            {/* Table */}
            <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-accent/50 px-4 py-3 grid grid-cols-6 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-3 w-full" />
                    ))}
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="px-4 py-4 border-t border-border grid grid-cols-6 gap-4 items-center">
                        {Array.from({ length: 6 }).map((_, j) => (
                            <Skeleton key={j} className="h-4 w-full" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
