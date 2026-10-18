'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[app error boundary]', error);
        reportBoundaryError(error, 'root');
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
            <ErrorState
                title="Something went wrong"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
