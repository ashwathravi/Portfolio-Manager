'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
    title?: string;
    message?: string;
    error?: Error & { digest?: string };
    onRetry?: () => void;
    retryLabel?: string;
    className?: string;
}

export function formatErrorMessage(error?: Error & { digest?: string }): string {
    if (!error) return 'An unexpected error occurred.';
    if (error.message && error.message.trim().length > 0) return error.message;
    if (error.digest) return `Error reference: ${error.digest}`;
    return 'An unexpected error occurred.';
}

export function ErrorState({
    title = 'Something went wrong',
    message,
    error,
    onRetry,
    retryLabel = 'Try again',
    className,
}: ErrorStateProps) {
    const displayMessage = message ?? formatErrorMessage(error);

    return (
        <div
            role="alert"
            className={cn(
                'flex flex-col items-center justify-center gap-4 p-8 text-center',
                className,
            )}
        >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="max-w-md text-sm text-muted-foreground">{displayMessage}</p>
                {error?.digest ? (
                    <p className="text-xs text-muted-foreground">
                        Reference: <code className="font-mono">{error.digest}</code>
                    </p>
                ) : null}
            </div>
            {onRetry ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCw className="h-4 w-4" />
                    {retryLabel}
                </Button>
            ) : null}
        </div>
    );
}
