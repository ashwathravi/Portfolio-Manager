'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function PortfoliosError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[portfolios error]', error);
        reportBoundaryError(error, 'portfolios');
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load portfolios"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
