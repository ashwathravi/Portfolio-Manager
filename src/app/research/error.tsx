'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function ResearchError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[research error]', error);
        reportBoundaryError(error, 'research');
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load research workspace"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
