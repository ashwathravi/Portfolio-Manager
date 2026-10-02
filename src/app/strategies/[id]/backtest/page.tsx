import { notFound, redirect } from 'next/navigation';
import { SEED_STRATEGIES } from '@/lib/strategies/seed';
import { isKnownStrategyId, strategyHref } from '@/lib/strategies/routes';

/** Legacy backtest results route — the backtest now lives beside the rules in the Strategies workspace. */
export default async function StrategyBacktestRedirect({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isKnownStrategyId(id, SEED_STRATEGIES)) notFound();
    redirect(strategyHref(id));
}
