import { Skeleton } from '@/components/ui/skeleton';

export default function StrategiesLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-80" />
            </div>

            {/* Overview stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-5 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                ))}
            </div>

            {/* Strategy cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                        </div>
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-10/12" />
                        <div className="flex gap-2 pt-2">
                            <Skeleton className="h-8 w-20 rounded-md" />
                            <Skeleton className="h-8 w-20 rounded-md" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
