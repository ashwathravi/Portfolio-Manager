import Link from 'next/link';
import { NotFoundSearchButton } from '@/components/command/NotFoundSearchButton';

/** 404 — one clear way back, plus search (⌘K) to find what they meant. */
export default function NotFound() {
    return (
        <div className="pm-page">
            <section className="pm-card pm-empty-card pm-not-found" data-testid="not-found">
                <h2>Page not found</h2>
                <p>The page you&apos;re looking for doesn&apos;t exist or has moved. Search for it, or go back to Today.</p>
                <div className="pm-empty-actions">
                    <NotFoundSearchButton />
                    <Link href="/" className="pm-btn pm-btn-ghost">Back to Today</Link>
                </div>
            </section>
        </div>
    );
}
