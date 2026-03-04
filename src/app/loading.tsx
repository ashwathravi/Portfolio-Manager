import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
    return (
        <div className="space-y-8 p-6">
            {/* Header */}
            <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-4 w-56" />
            </div>

            {/* Market chips */}
            <div className="flex gap-3">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-border p-6 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-8 w-40" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-xl border border-border p-6">
                    <Skeleton className="h-5 w-40 mb-4" />
                    <Skeleton className="h-[200px] w-full" />
                </div>
                <div className="rounded-xl border border-border p-6">
                    <Skeleton className="h-5 w-32 mb-4" />
                    <Skeleton className="h-[200px] w-full rounded-full mx-auto" style={{ width: '160px' }} />
                </div>
            </div>

            {/* Bottom section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-border p-5 space-y-3">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-7 w-36" />
                        </div>
                    ))}
                </div>
                <div className="space-y-3">
                    <Skeleton className="h-5 w-32" />
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-3 items-center">
                            <Skeleton className="h-9 w-9 rounded-full" />
                            <div className="flex-1 space-y-1">
                                <Skeleton className="h-3 w-24" />
                                <Skeleton className="h-3 w-16" />
                            </div>
                            <Skeleton className="h-4 w-16" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
