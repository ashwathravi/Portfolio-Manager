'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function ExecutionError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[execution error]', error);
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load the execution desk"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
