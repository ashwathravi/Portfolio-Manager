'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[app error boundary]', error);
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
