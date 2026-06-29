import type {
    AlphaRadarAgentWarning,
    AlphaRadarExternalOverlay,
} from './agent-contracts';
import type { AlphaRadarMemoChange } from './memo';

export type AlphaRadarOverlayKind = AlphaRadarExternalOverlay['kind'];
export type AlphaRadarOverlayProviderStatus = 'succeeded' | 'disabled' | 'failed';
export type AlphaRadarOverlayFilter = 'all' | AlphaRadarOverlayKind | string;

export interface AlphaRadarOverlayProviderInput {
    changes: readonly AlphaRadarMemoChange[];
    reportPeriod?: string;
}

export interface AlphaRadarOverlayProviderResult {
    provider: string;
    kind: AlphaRadarOverlayKind;
    status: AlphaRadarOverlayProviderStatus;
    overlays: AlphaRadarExternalOverlay[];
    warnings?: readonly AlphaRadarAgentWarning[];
    errorMessage?: string;
}

export interface AlphaRadarOverlayProvider {
    id: string;
    label: string;
    kind: AlphaRadarOverlayKind;
    fetchOverlays(input: AlphaRadarOverlayProviderInput): Promise<AlphaRadarOverlayProviderResult>;
}

export interface AlphaRadarOverlayIdea {
    change: AlphaRadarMemoChange;
    overlays: AlphaRadarExternalOverlay[];
    overlayKinds: AlphaRadarOverlayKind[];
    filterTokens: string[];
}

export interface AlphaRadarOverlayEnrichmentResult {
    overlays: AlphaRadarExternalOverlay[];
    ideas: AlphaRadarOverlayIdea[];
    providerResults: AlphaRadarOverlayProviderResult[];
    warnings: AlphaRadarAgentWarning[];
}

export class DisabledAlphaRadarOverlayProvider implements AlphaRadarOverlayProvider {
    constructor(
        public readonly kind: AlphaRadarOverlayKind,
        public readonly id = `disabled-${kind}`,
        public readonly label = `Disabled ${kind}`,
    ) {}

    async fetchOverlays(): Promise<AlphaRadarOverlayProviderResult> {
        return {
            provider: this.id,
            kind: this.kind,
            status: 'disabled',
            overlays: [],
            warnings: [{
                code: 'overlay_provider_disabled',
                message: `${this.label} is disabled.`,
            }],
        };
    }
}

export class FixtureAlphaRadarOverlayProvider implements AlphaRadarOverlayProvider {
    constructor(
        public readonly kind: AlphaRadarOverlayKind,
        private readonly fixtureOverlays: readonly AlphaRadarExternalOverlay[],
        public readonly id = `fixture-${kind}`,
        public readonly label = `Fixture ${kind}`,
    ) {}

    async fetchOverlays(input: AlphaRadarOverlayProviderInput): Promise<AlphaRadarOverlayProviderResult> {
        const tickers = new Set(input.changes.map((change) => change.ticker?.toUpperCase()).filter(Boolean));
        const overlays = this.fixtureOverlays
            .filter((overlay) => overlay.kind === this.kind)
            .filter((overlay) => !overlay.ticker || tickers.has(overlay.ticker.toUpperCase()))
            .map((overlay) => ({ ...overlay, provider: overlay.provider || this.id }));

        return {
            provider: this.id,
            kind: this.kind,
            status: 'succeeded',
            overlays,
        };
    }
}

export async function enrichAlphaRadarIdeasWithOverlays(input: {
    changes: readonly AlphaRadarMemoChange[];
    providers: readonly AlphaRadarOverlayProvider[];
    reportPeriod?: string;
}): Promise<AlphaRadarOverlayEnrichmentResult> {
    const providerResults: AlphaRadarOverlayProviderResult[] = [];
    const warnings: AlphaRadarAgentWarning[] = [];
    const overlays: AlphaRadarExternalOverlay[] = [];

    for (const provider of input.providers) {
        try {
            const result = await provider.fetchOverlays({
                changes: input.changes,
                reportPeriod: input.reportPeriod,
            });
            const normalized = normalizeProviderResult(provider, result);
            providerResults.push(normalized);
            overlays.push(...normalized.overlays);
            warnings.push(...normalized.warnings ?? []);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown overlay provider failure';
            const warning = {
                code: 'overlay_provider_failed',
                message: `${provider.label} failed: ${message}`,
                details: { provider: provider.id, kind: provider.kind },
            };
            providerResults.push({
                provider: provider.id,
                kind: provider.kind,
                status: 'failed',
                overlays: [],
                warnings: [warning],
                errorMessage: message,
            });
            warnings.push(warning);
        }
    }

    return {
        overlays,
        ideas: attachAlphaRadarOverlaysToIdeas({ changes: input.changes, overlays }),
        providerResults,
        warnings,
    };
}

export function attachAlphaRadarOverlaysToIdeas(input: {
    changes: readonly AlphaRadarMemoChange[];
    overlays: readonly AlphaRadarExternalOverlay[];
}): AlphaRadarOverlayIdea[] {
    return input.changes
        .filter((change) => change.changeType !== 'unchanged')
        .map((change) => {
            const overlays = input.overlays
                .filter(hasSourceCitation)
                .filter((overlay) => overlayMatchesChange(overlay, change))
                .sort(compareOverlays);
            const overlayKinds = [...new Set(overlays.map((overlay) => overlay.kind))].sort();
            return {
                change,
                overlays,
                overlayKinds,
                filterTokens: buildFilterTokens(overlays),
            };
        })
        .filter((idea) => idea.overlays.length > 0)
        .sort((a, b) => {
            const overlayDelta = b.overlays.length - a.overlays.length;
            if (overlayDelta !== 0) return overlayDelta;
            const materialityDelta = b.change.materialityScore - a.change.materialityScore;
            if (materialityDelta !== 0) return materialityDelta;
            return a.change.issuerName.localeCompare(b.change.issuerName);
        });
}

export function getAlphaRadarOverlayFilters(ideas: readonly AlphaRadarOverlayIdea[]): AlphaRadarOverlayFilter[] {
    const filters = new Set<AlphaRadarOverlayFilter>(['all']);
    for (const idea of ideas) {
        for (const kind of idea.overlayKinds) filters.add(kind);
        for (const token of idea.filterTokens) {
            if (token === 'ai infrastructure') filters.add('AI infrastructure');
            if (token === 'insider corroboration') filters.add('Insider corroboration');
        }
    }
    return [...filters];
}

export function filterAlphaRadarOverlayIdeas(
    ideas: readonly AlphaRadarOverlayIdea[],
    filter: AlphaRadarOverlayFilter,
): AlphaRadarOverlayIdea[] {
    if (filter === 'all') return [...ideas];
    const normalized = normalizeToken(filter);
    return ideas.filter((idea) => {
        if (idea.overlayKinds.some((kind) => normalizeToken(kind) === normalized)) return true;
        return idea.filterTokens.some((token) => token === normalized);
    });
}

function normalizeProviderResult(
    provider: AlphaRadarOverlayProvider,
    result: AlphaRadarOverlayProviderResult,
): AlphaRadarOverlayProviderResult {
    const overlays = result.overlays.filter(hasSourceCitation);
    const dropped = result.overlays.length - overlays.length;
    const warnings = [...result.warnings ?? []];
    if (dropped > 0) {
        warnings.push({
            code: 'overlay_missing_citation',
            message: `${dropped} ${provider.label} overlay${dropped === 1 ? '' : 's'} were dropped because they lacked source evidence.`,
            details: { provider: provider.id, kind: provider.kind },
        });
    }

    return {
        ...result,
        provider: result.provider || provider.id,
        kind: result.kind || provider.kind,
        overlays,
        warnings,
    };
}

function hasSourceCitation(overlay: AlphaRadarExternalOverlay): boolean {
    return Boolean(
        overlay.provider.trim()
        && overlay.summary.trim()
        && overlay.asOf.trim()
        && overlay.evidence.length > 0
        && overlay.evidence.every((evidence) => evidence.id.trim() && evidence.title.trim()),
    );
}

function overlayMatchesChange(overlay: AlphaRadarExternalOverlay, change: AlphaRadarMemoChange): boolean {
    const overlayTicker = overlay.ticker?.toUpperCase();
    const changeTicker = change.ticker?.toUpperCase();
    if (overlayTicker && changeTicker && overlayTicker === changeTicker) return true;

    const overlayIssuer = normalizeIssuer(overlay.issuerName);
    const changeIssuer = normalizeIssuer(change.issuerName);
    return Boolean(
        overlayIssuer
        && changeIssuer
        && (overlayIssuer === changeIssuer || overlayIssuer.includes(changeIssuer) || changeIssuer.includes(overlayIssuer)),
    );
}

function buildFilterTokens(overlays: readonly AlphaRadarExternalOverlay[]): string[] {
    const tokens = new Set<string>();
    for (const overlay of overlays) {
        const haystack = `${overlay.kind} ${overlay.provider} ${overlay.summary} ${overlay.evidence.map((item) => `${item.title} ${item.citation ?? ''}`).join(' ')}`;
        const normalized = normalizeToken(haystack);
        if (normalized.includes('ai infrastructure') || normalized.includes('accelerator') || normalized.includes('data center')) {
            tokens.add('ai infrastructure');
        }
        if (overlay.kind === 'insider-activity' || normalized.includes('insider')) {
            tokens.add('insider corroboration');
        }
        tokens.add(normalizeToken(overlay.kind));
    }
    return [...tokens].sort();
}

function compareOverlays(a: AlphaRadarExternalOverlay, b: AlphaRadarExternalOverlay): number {
    const kindDelta = a.kind.localeCompare(b.kind);
    if (kindDelta !== 0) return kindDelta;
    return a.provider.localeCompare(b.provider);
}

function normalizeIssuer(value: string): string {
    return normalizeToken(value)
        .replace(/\b(inc|corp|corporation|co|company|ltd|limited|plc|class|cl|common|stock)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeToken(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
