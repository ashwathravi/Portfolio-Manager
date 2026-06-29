import { alphaRadarReportSchema, type AlphaRadarReportInput } from '@/lib/validators/alpha-radar';
import type { AlphaRadarHoldingChange } from './diff';

export const ALPHA_RADAR_DETERMINISTIC_MEMO_VERSION = 'deterministic-v1';

export type AlphaRadarMemoChange = AlphaRadarHoldingChange & {
    id?: string;
};

export interface GenerateAlphaRadarMemoInput {
    trackedFilerId: string;
    filingId?: string;
    filerName: string;
    reportPeriod: string;
    sourceFilingIds: readonly string[];
    changes: readonly AlphaRadarMemoChange[];
    generatorVersion?: string;
}

export interface AlphaRadarMemoAdapter {
    generate(input: GenerateAlphaRadarMemoInput): Promise<AlphaRadarReportInput>;
}

export class DeterministicAlphaRadarMemoAdapter implements AlphaRadarMemoAdapter {
    async generate(input: GenerateAlphaRadarMemoInput): Promise<AlphaRadarReportInput> {
        return generateAlphaRadarMemo(input);
    }
}

export function generateAlphaRadarMemo(input: GenerateAlphaRadarMemoInput): AlphaRadarReportInput {
    const sortedChanges = [...input.changes].sort(compareMemoChanges);
    const changed = sortedChanges.filter((change) => change.changeType !== 'unchanged');
    const overlap = sortedChanges.filter((change) => change.userRelevance.reasons.length > 0);
    const topAdds = sortedChanges.filter((change) => change.changeType === 'increased');
    const trims = sortedChanges.filter((change) => change.changeType === 'decreased');
    const exits = sortedChanges.filter((change) => change.changeType === 'exited');
    const newPositions = sortedChanges.filter((change) => change.changeType === 'new');
    const summary = buildSummary(input, changed, overlap);
    const sections = [
        section('summary', 'Summary', 'summary', buildSummaryMarkdown(input, changed, overlap), changed),
        section('top-adds', 'Top adds', 'top_adds', buildChangeList(topAdds, 'No material adds detected.'), topAdds),
        section('trims', 'Trims and reductions', 'trims', buildChangeList(trims, 'No material trims detected.'), trims),
        section('exits', 'Exited positions', 'exits', buildChangeList(exits, 'No exits detected.'), exits),
        section('new-positions', 'New positions', 'new_positions', buildChangeList(newPositions, 'No new positions detected.'), newPositions),
        section('overlap', 'Portfolio Manager overlap', 'overlap', buildOverlapMarkdown(overlap), overlap),
        section('watch-next', 'Watch next', 'watch_next', buildWatchNextMarkdown(sortedChanges), sortedChanges.slice(0, 5)),
        section('risks', 'Caveats', 'risks', buildRisksMarkdown(input), []),
    ];
    const markdown = [
        `# ${input.filerName} Alpha Radar ${input.reportPeriod}`,
        '',
        summary,
        '',
        ...sections.map((item) => `## ${item.title}\n\n${item.markdown}`),
    ].join('\n');
    const report: AlphaRadarReportInput = {
        trackedFilerId: input.trackedFilerId,
        filingId: input.filingId,
        reportPeriod: input.reportPeriod,
        status: 'generated',
        title: `${input.filerName} Alpha Radar ${input.reportPeriod}`,
        summary,
        sections,
        markdown,
        sourceFilingIds: [...input.sourceFilingIds],
        generatorVersion: input.generatorVersion ?? ALPHA_RADAR_DETERMINISTIC_MEMO_VERSION,
    };
    const validation = alphaRadarReportSchema.safeParse(report);
    if (!validation.success) {
        const issue = validation.error.issues[0];
        throw new Error(`Alpha Radar memo failed validation: ${issue?.message ?? 'unknown error'}`);
    }

    return validation.data;
}

function section(
    id: string,
    title: string,
    kind: AlphaRadarReportInput['sections'][number]['kind'],
    markdown: string,
    changes: readonly AlphaRadarMemoChange[],
): AlphaRadarReportInput['sections'][number] {
    return {
        id,
        title,
        kind,
        markdown,
        changeIds: changes.map((change) => change.id).filter(isUuid),
    };
}

function buildSummary(
    input: GenerateAlphaRadarMemoInput,
    changed: readonly AlphaRadarMemoChange[],
    overlap: readonly AlphaRadarMemoChange[],
): string {
    if (input.changes.length === 0) {
        return `${input.filerName} has no parsed 13F holdings available for ${input.reportPeriod}.`;
    }

    if (changed.length === 0) {
        return `${input.filerName} had no material quarter-over-quarter 13F position changes in ${input.reportPeriod}.`;
    }

    const top = changed[0];
    const overlapCopy = overlap.length > 0 ? ` ${overlap.length} change${overlap.length === 1 ? '' : 's'} overlap with Portfolio Manager objects.` : '';
    return `${input.filerName} had ${changed.length} ranked 13F change${changed.length === 1 ? '' : 's'} in ${input.reportPeriod}. Top signal: ${top.displayReason}${overlapCopy}`;
}

function buildSummaryMarkdown(
    input: GenerateAlphaRadarMemoInput,
    changed: readonly AlphaRadarMemoChange[],
    overlap: readonly AlphaRadarMemoChange[],
): string {
    if (input.changes.length === 0 || changed.length === 0) return buildSummary(input, changed, overlap);

    return [
        buildSummary(input, changed, overlap),
        '',
        ...changed.slice(0, 3).map((change) => `- ${change.displayReason} Materiality ${change.materialityScore}/100.`),
    ].join('\n');
}

function buildChangeList(changes: readonly AlphaRadarMemoChange[], emptyText: string): string {
    if (changes.length === 0) return emptyText;
    return changes.slice(0, 5).map((change) => `- ${change.displayReason} Materiality ${change.materialityScore}/100.`).join('\n');
}

function buildOverlapMarkdown(changes: readonly AlphaRadarMemoChange[]): string {
    if (changes.length === 0) {
        return 'No direct overlap with current Portfolio Manager holdings, watchlist tickers, or active theses was detected.';
    }

    return changes
        .slice(0, 5)
        .map((change) => `- ${displayName(change)}: ${change.userRelevance.reasons.join(', ')}.`)
        .join('\n');
}

function buildWatchNextMarkdown(changes: readonly AlphaRadarMemoChange[]): string {
    const material = changes.filter((change) => change.changeType !== 'unchanged').slice(0, 3);
    if (material.length === 0) {
        return 'Watch for the next filing, manager commentary, or overlap with existing theses before taking action.';
    }

    return material.map((change) => `- Re-check ${displayName(change)} after the next 13F or portfolio event. Reason: ${change.displayReason}`).join('\n');
}

function buildRisksMarkdown(input: GenerateAlphaRadarMemoInput): string {
    return [
        `Source filings: ${input.sourceFilingIds.join(', ')}.`,
        '13F data is delayed, can omit short positions and non-reportable securities, and reflects holdings as of quarter end rather than today.',
        'This memo is deterministic research context, not a trading recommendation.',
    ].join('\n');
}

function compareMemoChanges(a: AlphaRadarMemoChange, b: AlphaRadarMemoChange): number {
    const scoreDelta = b.materialityScore - a.materialityScore;
    if (scoreDelta !== 0) return scoreDelta;

    const valueDelta = Math.abs(b.valueDeltaUsd ?? 0) - Math.abs(a.valueDeltaUsd ?? 0);
    if (valueDelta !== 0) return valueDelta;

    return displayName(a).localeCompare(displayName(b));
}

function displayName(change: AlphaRadarMemoChange): string {
    return change.ticker ? `${change.issuerName} (${change.ticker})` : change.issuerName;
}

function isUuid(value: string | undefined): value is string {
    return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
