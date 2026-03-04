import { Skeleton } from '@/components/ui/skeleton';

export default function PerformanceLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-4 w-80" />
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-5 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                ))}
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-5 space-y-3">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                ))}
            </div>

            {/* Charts */}
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-6 space-y-4">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-[200px] w-full" />
                </div>
            ))}
        </div>
    );
}
