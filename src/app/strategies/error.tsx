'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function StrategiesError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[strategies error]', error);
        reportBoundaryError(error, 'strategies');
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load strategies"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
