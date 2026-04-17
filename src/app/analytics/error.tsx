'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function AnalyticsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[analytics error]', error);
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load analytics"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
