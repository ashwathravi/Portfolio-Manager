import { Skeleton } from '@/components/ui/skeleton';

export default function ExecutionLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-72" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Order form */}
                <div className="rounded-lg border border-border p-6 space-y-4">
                    <Skeleton className="h-5 w-32" />
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-20 rounded-md" />
                        <Skeleton className="h-9 w-20 rounded-md" />
                    </div>
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    ))}
                    <Skeleton className="h-10 w-full rounded-md" />
                </div>

                {/* Order blotter */}
                <div className="lg:col-span-2 rounded-lg border border-border p-6 space-y-4">
                    <div className="flex gap-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-8 w-24 rounded-md" />
                        ))}
                    </div>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            </div>
        </div>
    );
}
