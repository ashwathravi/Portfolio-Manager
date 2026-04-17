'use client';

import { useEffect } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[global error boundary]', error);
    }, [error]);

    return (
        <html lang="en">
            <body>
                <div
                    role="alert"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '1rem',
                        minHeight: '100vh',
                        padding: '2rem',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        textAlign: 'center',
                    }}
                >
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                        Application error
                    </h1>
                    <p style={{ maxWidth: '32rem', color: '#6b7280' }}>
                        A critical error occurred and the app could not recover.
                        {error.digest ? ` Reference: ${error.digest}` : ''}
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #d1d5db',
                            background: 'white',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
