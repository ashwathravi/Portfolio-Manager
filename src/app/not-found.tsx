import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
                <FileQuestion className="h-6 w-6" />
            </div>
            <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">Page not found</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>
            </div>
            <Button asChild variant="outline" size="sm">
                <Link href="/">Back to dashboard</Link>
            </Button>
        </div>
    );
}
