'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function PerformanceError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[performance error]', error);
        reportBoundaryError(error, 'performance');
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
