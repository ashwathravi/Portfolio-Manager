import { Skeleton } from '@/components/ui/skeleton';

export default function HoldingsLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-72" />
            </div>

            {/* Filter bar skeleton */}
            <div className="flex gap-3">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
            </div>

            {/* Table skeleton */}
            <div className="rounded-lg border border-border overflow-hidden">
                {/* Header */}
                <div className="bg-accent/50 px-4 py-3 grid grid-cols-6 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-3 w-full" />
                    ))}
                </div>
                {/* Rows */}
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="px-4 py-4 border-t border-border grid grid-cols-6 gap-4 items-center">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="space-y-1">
                                <Skeleton className="h-3 w-12" />
                                <Skeleton className="h-3 w-20" />
                            </div>
                        </div>
                        <Skeleton className="h-3 w-16 ml-auto" />
                        <Skeleton className="h-3 w-14 ml-auto" />
                        <Skeleton className="h-3 w-18 ml-auto" />
                        <Skeleton className="h-3 w-16 ml-auto" />
                        <Skeleton className="h-5 w-12 ml-auto rounded-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}
