'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function StrategiesError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[strategies error]', error);
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
