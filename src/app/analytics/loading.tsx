import { Skeleton } from '@/components/ui/skeleton';

export default function AnalyticsLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-4 w-80" />
            </div>

            {/* Top metric cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-5 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                ))}
            </div>

            {/* Heatmap + calendar */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-6 space-y-4">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-[240px] w-full" />
                    </div>
                ))}
            </div>

            {/* Table */}
            <div className="rounded-lg border border-border p-6 space-y-3">
                <Skeleton className="h-5 w-40" />
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                ))}
            </div>
        </div>
    );
}
