import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-4 w-72" />
            </div>

            {/* Tab list */}
            <div className="flex flex-wrap gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-28 rounded-md" />
                ))}
            </div>

            {/* Tab content */}
            <div className="rounded-lg border border-border p-6 space-y-4">
                <Skeleton className="h-5 w-40" />
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                ))}
                <Skeleton className="h-10 w-32 rounded-md" />
            </div>
        </div>
    );
}
