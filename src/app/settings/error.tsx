'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportBoundaryError } from '@/lib/observability/report-boundary-error';

export default function SettingsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[settings error]', error);
        reportBoundaryError(error, 'settings');
    }, [error]);

    return (
        <div className="p-6">
            <ErrorState
                title="Couldn't load settings"
                error={error}
                onRetry={reset}
            />
        </div>
    );
}
