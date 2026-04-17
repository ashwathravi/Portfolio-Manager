'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function PerformanceError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[performance error]', error);
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load performance data"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
