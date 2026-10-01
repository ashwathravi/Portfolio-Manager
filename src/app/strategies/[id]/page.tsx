import { notFound, redirect } from 'next/navigation';
import { SEED_STRATEGIES } from '@/lib/strategies/seed';
import { isKnownStrategyId, strategyHref } from '@/lib/strategies/routes';

/** Legacy strategy detail route — opens the Strategies workspace with this strategy selected. */
export default async function StrategyDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isKnownStrategyId(id, SEED_STRATEGIES)) notFound();
    redirect(strategyHref(id));
}
