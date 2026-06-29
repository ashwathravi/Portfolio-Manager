import {
    DEFAULT_BUCKET_POLICIES,
    type PolicyBucketId,
    type PolicyBucketPolicy,
    type PolicyClassifiableHolding,
    computeBucketAllocation,
    policyBucketLabel,
    resolvePolicyBucketAssignment,
} from "./buckets";
import {
    DEFAULT_OPTION_RISK_POSITIONS,
    DEFAULT_OPTIONS_RISK_POLICY,
    type OptionRiskPosition,
    type OptionsRiskPolicy,
    optionPremiumAtRisk,
} from "./options";
import {
    DEFAULT_THEME_CAPS,
    type ThemeExposureHolding,
    type ThemeId,
    type ThemeWeight,
    computeThemeExposure,
    themeLabel,
    themeWeightsForSymbol,
} from "./themes";

export const PRE_TRADE_RISK_POLICY_RULE_TYPES = [
    "single_position_allocation",
    "employer_stock_allocation",
    "bucket_allocation",
    "theme_factor_allocation",
    "options_speculative_allocation",
    "special_situation_allocation",
    "no_add_to_breached_position",
    "stale_thesis",
    "missing_bucket_classification",
] as const;

export type PreTradeRiskPolicyRuleType = (typeof PRE_TRADE_RISK_POLICY_RULE_TYPES)[number];
export type PreTradeRiskPolicyStatus = "pass" | "warn" | "fail" | "missing_data";
export type PreTradeRiskPolicyDecision = "allowed" | "override_required" | "blocked";
export type PreTradeRiskPolicyDirection = "risk_increasing" | "risk_reducing" | "neutral" | "missing_data";

export interface PreTradeRiskPolicyHolding extends ThemeExposureHolding {
    ticker?: string | null;
    linkedThesis?: string;
    thesisUpdatedAt?: string;
}

export interface PreTradeRiskPolicyTrade {
    ticker: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    instrumentType?: "equity" | "option";
    marketValue?: number;
    policyBucket?: PolicyBucketId | null;
    themeWeights?: readonly ThemeWeight[] | null;
    linkedThesisId?: string;
    thesisUpdatedAt?: string;
    optionPremiumAtRisk?: number;
}

export interface PreTradeRiskPolicyInput {
    holdings: readonly PreTradeRiskPolicyHolding[];
    trade: PreTradeRiskPolicyTrade;
    portfolioValue?: number;
    bucketPolicies?: readonly PolicyBucketPolicy[];
    themeCaps?: Readonly<Partial<Record<ThemeId, number>>>;
    optionsRiskPolicy?: Partial<OptionsRiskPolicy>;
    existingOptionPositions?: readonly OptionRiskPosition[];
    maxSinglePositionPct?: number;
    thesisMaxAgeDays?: number;
    overrideReason?: string;
    asOf?: Date | string;
}

export interface PreTradeRiskPolicyCheck {
    ruleType: PreTradeRiskPolicyRuleType;
    status: PreTradeRiskPolicyStatus;
    decision: PreTradeRiskPolicyDecision;
    label: string;
    message: string;
    currentPct: number;
    postPct: number;
    thresholdPct: number;
    currentValue: number;
    postValue: number;
    thresholdValue: number;
    deltaPct: number;
    direction: PreTradeRiskPolicyDirection;
    impactedSymbols: string[];
    overrideRequired: boolean;
}

export interface RiskPolicyException {
    ruleType: PreTradeRiskPolicyRuleType;
    symbol: string;
    reason: string;
    currentPct: number;
    postPct: number;
    thresholdPct: number;
    message: string;
    capturedAt: string;
}

export interface PreTradeRiskPolicyImpact {
    decision: PreTradeRiskPolicyDecision;
    blocksSubmit: boolean;
    requiresOverride: boolean;
    overrideAccepted: boolean;
    direction: PreTradeRiskPolicyDirection;
    summary: string;
    checks: PreTradeRiskPolicyCheck[];
    failedChecks: PreTradeRiskPolicyCheck[];
    exceptionPreview: RiskPolicyException[];
}

const DEFAULT_MAX_SINGLE_POSITION_PCT = 25;
const DEFAULT_THESIS_MAX_AGE_DAYS = 180;
const OVERRIDE_MIN_CHARS = 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function evaluatePreTradeRiskPolicy(input: PreTradeRiskPolicyInput): PreTradeRiskPolicyImpact {
    const asOf = normalizeDate(input.asOf);
    const holdings = normalizeHoldings(input.holdings);
    const trade = normalizeTrade(input.trade);
    const portfolioValue = safeMoney(
        input.portfolioValue ??
        holdings.reduce((sum, holding) => sum + safeMoney(holding.marketValue), 0),
    );
    const overrideReason = input.overrideReason?.trim() ?? "";
    const overrideAccepted = overrideReason.length >= OVERRIDE_MIN_CHARS;
    const tradeValue = trade.instrumentType === "option"
        ? safeMoney(trade.optionPremiumAtRisk ?? trade.marketValue)
        : safeMoney(trade.marketValue);

    if (!trade.ticker || portfolioValue <= 0 || tradeValue <= 0) {
        return emptyImpact("Risk policy needs ticker, price, quantity, and portfolio value.");
    }

    const currentHoldingValue = valueForSymbol(holdings, trade.ticker);
    const postHoldingValue = trade.side === "buy"
        ? currentHoldingValue + tradeValue
        : Math.max(0, currentHoldingValue - tradeValue);
    const positionCheck = buildPositionCheck({
        trade,
        currentValue: currentHoldingValue,
        postValue: postHoldingValue,
        thresholdPct: input.maxSinglePositionPct ?? DEFAULT_MAX_SINGLE_POSITION_PCT,
        portfolioValue,
    });

    const tradeHolding = holdingForTrade(trade, tradeValue);
    const bucketAssignment = resolvePolicyBucketAssignment(tradeHolding);
    const currentBucketAllocation = computeBucketAllocation(holdings, input.bucketPolicies ?? DEFAULT_BUCKET_POLICIES);
    const postHoldings = buildPostTradeHoldings(holdings, tradeHolding, tradeValue, trade.side);
    const postBucketAllocation = computeBucketAllocation(postHoldings, input.bucketPolicies ?? DEFAULT_BUCKET_POLICIES);
    const currentThemeExposure = computeThemeExposure(holdings, input.themeCaps ?? DEFAULT_THEME_CAPS);
    const postThemeExposure = computeThemeExposure(postHoldings, input.themeCaps ?? DEFAULT_THEME_CAPS);

    const checks: PreTradeRiskPolicyCheck[] = [
        positionCheck,
        ...buildBucketChecks({
            trade,
            bucket: bucketAssignment.bucket,
            portfolioValue,
            currentBucketAllocation,
            postBucketAllocation,
        }),
        ...buildThemeChecks({
            trade,
            portfolioValue,
            currentThemeExposure,
            postThemeExposure,
            tradeWeights: themeWeightsForSymbol(trade.ticker, trade.themeWeights),
        }),
        buildOptionsCheck({
            trade,
            tradeValue,
            portfolioValue,
            existingOptionPositions: input.existingOptionPositions ?? DEFAULT_OPTION_RISK_POSITIONS,
            policy: input.optionsRiskPolicy,
        }),
        buildMissingBucketCheck({ trade, bucketAssignment, tradeValue, portfolioValue }),
        buildStaleThesisCheck({
            trade,
            asOf,
            thesisMaxAgeDays: input.thesisMaxAgeDays ?? DEFAULT_THESIS_MAX_AGE_DAYS,
            tradeValue,
            portfolioValue,
        }),
    ].filter((check): check is PreTradeRiskPolicyCheck => check !== null);

    const actionable = checks.filter((check) => check.status !== "pass");
    const requiresOverride = actionable.some((check) => check.overrideRequired);
    const blocked = actionable.some((check) => check.decision === "blocked");
    const blocksSubmit = blocked || (requiresOverride && !overrideAccepted);
    const decision: PreTradeRiskPolicyDecision = blocked
        ? "blocked"
        : requiresOverride && !overrideAccepted
            ? "override_required"
            : "allowed";
    const exceptionPreview = overrideAccepted
        ? buildRiskPolicyExceptions(actionable.filter((check) => check.overrideRequired), trade.ticker, overrideReason, asOf)
        : [];

    return {
        decision,
        blocksSubmit,
        requiresOverride,
        overrideAccepted,
        direction: summarizeDirection(checks),
        summary: summarizeImpact(checks, requiresOverride, overrideAccepted),
        checks,
        failedChecks: actionable,
        exceptionPreview,
    };
}

export function buildRiskPolicyExceptions(
    checks: readonly PreTradeRiskPolicyCheck[],
    symbol: string,
    reason: string,
    capturedAt: Date | string = new Date(),
): RiskPolicyException[] {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < OVERRIDE_MIN_CHARS) return [];
    const captured = normalizeDate(capturedAt).toISOString();
    return checks
        .filter((check) => check.overrideRequired && check.status !== "pass")
        .map((check) => ({
            ruleType: check.ruleType,
            symbol: normalizeSymbol(symbol),
            reason: trimmedReason,
            currentPct: roundPct(check.currentPct),
            postPct: roundPct(check.postPct),
            thresholdPct: roundPct(check.thresholdPct),
            message: check.message,
            capturedAt: captured,
        }));
}

function buildPositionCheck({
    trade,
    currentValue,
    postValue,
    thresholdPct,
    portfolioValue,
}: {
    trade: NormalizedTrade;
    currentValue: number;
    postValue: number;
    thresholdPct: number;
    portfolioValue: number;
}): PreTradeRiskPolicyCheck {
    const currentPct = percentOf(currentValue, portfolioValue);
    const postPct = percentOf(postValue, portfolioValue);
    const direction = directionFor(currentPct, postPct);
    const thresholdValue = valueFromPct(thresholdPct, portfolioValue);
    const breached = postPct > thresholdPct;
    const alreadyBreachedAdd = trade.side === "buy" && currentPct > thresholdPct && postPct > currentPct;
    const status: PreTradeRiskPolicyStatus = breached && direction === "risk_increasing" ? "fail" : "pass";
    const overrideRequired = status !== "pass";
    const label = alreadyBreachedAdd ? "No add to breached position" : "Single-position cap";
    return {
        ruleType: alreadyBreachedAdd ? "no_add_to_breached_position" : "single_position_allocation",
        status,
        decision: overrideRequired ? "override_required" : "allowed",
        label,
        message: status === "pass"
            ? direction === "risk_reducing"
                ? `${trade.ticker} trim reduces single-position risk.`
                : `${trade.ticker} remains inside the ${thresholdPct}% single-position cap.`
            : `${trade.ticker} moves from ${fmtPct(currentPct)} to ${fmtPct(postPct)} of portfolio; cap is ${fmtPct(thresholdPct)}.`,
        currentPct,
        postPct,
        thresholdPct,
        currentValue,
        postValue,
        thresholdValue,
        deltaPct: postPct - currentPct,
        direction,
        impactedSymbols: [trade.ticker],
        overrideRequired,
    };
}

function buildBucketChecks({
    trade,
    bucket,
    portfolioValue,
    currentBucketAllocation,
    postBucketAllocation,
}: {
    trade: NormalizedTrade;
    bucket: PolicyBucketId;
    portfolioValue: number;
    currentBucketAllocation: ReturnType<typeof computeBucketAllocation>;
    postBucketAllocation: ReturnType<typeof computeBucketAllocation>;
}): PreTradeRiskPolicyCheck[] {
    if (bucket === "unassigned") return [];
    const current = currentBucketAllocation.rows.find((row) => row.bucket === bucket);
    const post = postBucketAllocation.rows.find((row) => row.bucket === bucket);
    if (!current || !post || post.maxPct == null) return [];
    const thresholdPct = post.maxPct;
    const currentPct = percentOf(current.marketValue, portfolioValue);
    const postPct = percentOf(post.marketValue, portfolioValue);
    const direction = directionFor(currentPct, postPct);
    const isSpecial = bucket === "special_situation";
    if (postPct <= thresholdPct || direction !== "risk_increasing") {
        return [{
            ruleType: isSpecial ? "special_situation_allocation" : "bucket_allocation",
            status: "pass",
            decision: "allowed",
            label: isSpecial ? "Special-situation cap" : `${policyBucketLabel(bucket)} cap`,
            message: direction === "risk_reducing"
                ? `${policyBucketLabel(bucket)} exposure falls from ${fmtPct(currentPct)} to ${fmtPct(postPct)}.`
                : `${policyBucketLabel(bucket)} exposure remains inside policy.`,
            currentPct,
            postPct,
            thresholdPct,
            currentValue: current.marketValue,
            postValue: post.marketValue,
            thresholdValue: valueFromPct(thresholdPct, portfolioValue),
            deltaPct: postPct - currentPct,
            direction,
            impactedSymbols: [trade.ticker],
            overrideRequired: false,
        }];
    }
    return [{
        ruleType: isSpecial ? "special_situation_allocation" : "bucket_allocation",
        status: "fail",
        decision: "override_required",
        label: isSpecial ? "Special-situation cap" : `${policyBucketLabel(bucket)} cap`,
        message: `${policyBucketLabel(bucket)} exposure worsens from ${fmtPct(currentPct)} to ${fmtPct(postPct)}; cap is ${fmtPct(thresholdPct)}.`,
        currentPct,
        postPct,
        thresholdPct,
        currentValue: current.marketValue,
        postValue: post.marketValue,
        thresholdValue: valueFromPct(thresholdPct, portfolioValue),
        deltaPct: postPct - currentPct,
        direction,
        impactedSymbols: [trade.ticker],
        overrideRequired: true,
    }];
}

function buildThemeChecks({
    trade,
    portfolioValue,
    currentThemeExposure,
    postThemeExposure,
    tradeWeights,
}: {
    trade: NormalizedTrade;
    portfolioValue: number;
    currentThemeExposure: ReturnType<typeof computeThemeExposure>;
    postThemeExposure: ReturnType<typeof computeThemeExposure>;
    tradeWeights: readonly ThemeWeight[];
}): PreTradeRiskPolicyCheck[] {
    const seen = new Set<ThemeId>();
    return tradeWeights
        .filter((weight) => {
            if (seen.has(weight.theme)) return false;
            seen.add(weight.theme);
            return true;
        })
        .flatMap((weight): PreTradeRiskPolicyCheck[] => {
            const current = currentThemeExposure.rows.find((row) => row.theme === weight.theme);
            const post = postThemeExposure.rows.find((row) => row.theme === weight.theme);
            if (!current || !post || post.maxPct == null || weight.theme === "unknown") return [];
            const currentPct = percentOf(current.marketValue, portfolioValue);
            const postPct = percentOf(post.marketValue, portfolioValue);
            const direction = directionFor(currentPct, postPct);
            const ruleType: PreTradeRiskPolicyRuleType = weight.theme === "employer_linked_wealth"
                ? "employer_stock_allocation"
                : "theme_factor_allocation";
            const label = weight.theme === "employer_linked_wealth"
                ? "Employer-linked wealth cap"
                : `${themeLabel(weight.theme)} cap`;
            if (postPct <= post.maxPct || direction !== "risk_increasing") {
                return [{
                    ruleType,
                    status: "pass",
                    decision: "allowed",
                    label,
                    message: direction === "risk_reducing"
                        ? `${themeLabel(weight.theme)} exposure falls from ${fmtPct(currentPct)} to ${fmtPct(postPct)}.`
                        : `${themeLabel(weight.theme)} exposure remains inside policy.`,
                    currentPct,
                    postPct,
                    thresholdPct: post.maxPct,
                    currentValue: current.marketValue,
                    postValue: post.marketValue,
                    thresholdValue: valueFromPct(post.maxPct, portfolioValue),
                    deltaPct: postPct - currentPct,
                    direction,
                    impactedSymbols: [trade.ticker],
                    overrideRequired: false,
                }];
            }
            return [{
                ruleType,
                status: "fail",
                decision: "override_required",
                label,
                message: `${themeLabel(weight.theme)} exposure worsens from ${fmtPct(currentPct)} to ${fmtPct(postPct)}; cap is ${fmtPct(post.maxPct)}.`,
                currentPct,
                postPct,
                thresholdPct: post.maxPct,
                currentValue: current.marketValue,
                postValue: post.marketValue,
                thresholdValue: valueFromPct(post.maxPct, portfolioValue),
                deltaPct: postPct - currentPct,
                direction,
                impactedSymbols: [trade.ticker],
                overrideRequired: true,
            }];
        });
}

function buildOptionsCheck({
    trade,
    tradeValue,
    portfolioValue,
    existingOptionPositions,
    policy,
}: {
    trade: NormalizedTrade;
    tradeValue: number;
    portfolioValue: number;
    existingOptionPositions: readonly OptionRiskPosition[];
    policy?: Partial<OptionsRiskPolicy>;
}): PreTradeRiskPolicyCheck | null {
    if (trade.instrumentType !== "option" && existingOptionPositions.length === 0) return null;
    const resolvedPolicy = { ...DEFAULT_OPTIONS_RISK_POLICY, ...policy };
    const currentPremium = existingOptionPositions.reduce((sum, position) => sum + optionPremiumAtRisk(position), 0);
    const postPremium = trade.instrumentType === "option"
        ? trade.side === "buy"
            ? currentPremium + tradeValue
            : Math.max(0, currentPremium - tradeValue)
        : currentPremium;
    const currentPct = percentOf(currentPremium, portfolioValue);
    const postPct = percentOf(postPremium, portfolioValue);
    const direction = directionFor(currentPct, postPct);
    const status: PreTradeRiskPolicyStatus = postPct > resolvedPolicy.maxTotalPremiumPct && direction === "risk_increasing"
        ? "fail"
        : "pass";
    return {
        ruleType: "options_speculative_allocation",
        status,
        decision: status === "pass" ? "allowed" : "override_required",
        label: "Options premium budget",
        message: status === "pass"
            ? direction === "risk_reducing"
                ? `Options premium at risk falls from ${fmtPct(currentPct)} to ${fmtPct(postPct)}.`
                : `Options premium at risk remains inside the ${fmtPct(resolvedPolicy.maxTotalPremiumPct)} cap.`
            : `Options premium at risk worsens from ${fmtPct(currentPct)} to ${fmtPct(postPct)}; cap is ${fmtPct(resolvedPolicy.maxTotalPremiumPct)}.`,
        currentPct,
        postPct,
        thresholdPct: resolvedPolicy.maxTotalPremiumPct,
        currentValue: currentPremium,
        postValue: postPremium,
        thresholdValue: valueFromPct(resolvedPolicy.maxTotalPremiumPct, portfolioValue),
        deltaPct: postPct - currentPct,
        direction,
        impactedSymbols: [trade.ticker],
        overrideRequired: status !== "pass",
    };
}

function buildMissingBucketCheck({
    trade,
    bucketAssignment,
    tradeValue,
    portfolioValue,
}: {
    trade: NormalizedTrade;
    bucketAssignment: ReturnType<typeof resolvePolicyBucketAssignment>;
    tradeValue: number;
    portfolioValue: number;
}): PreTradeRiskPolicyCheck | null {
    if (trade.side !== "buy" || bucketAssignment.source !== "missing") return null;
    const pct = percentOf(tradeValue, portfolioValue);
    return {
        ruleType: "missing_bucket_classification",
        status: "missing_data",
        decision: "override_required",
        label: "Missing policy bucket",
        message: `${trade.ticker} has no policy bucket classification; classify it before adding or capture an override.`,
        currentPct: 0,
        postPct: pct,
        thresholdPct: 0,
        currentValue: 0,
        postValue: tradeValue,
        thresholdValue: 0,
        deltaPct: pct,
        direction: "missing_data",
        impactedSymbols: [trade.ticker],
        overrideRequired: true,
    };
}

function buildStaleThesisCheck({
    trade,
    asOf,
    thesisMaxAgeDays,
    tradeValue,
    portfolioValue,
}: {
    trade: NormalizedTrade;
    asOf: Date;
    thesisMaxAgeDays: number;
    tradeValue: number;
    portfolioValue: number;
}): PreTradeRiskPolicyCheck | null {
    if (trade.side !== "buy") return null;
    const pct = percentOf(tradeValue, portfolioValue);
    if (!trade.linkedThesisId) {
        return null;
    }

    if (!trade.thesisUpdatedAt) return null;
    const updatedAt = normalizeDate(trade.thesisUpdatedAt);
    const ageDays = Math.floor((asOf.getTime() - updatedAt.getTime()) / MS_PER_DAY);
    if (!Number.isFinite(ageDays) || ageDays <= thesisMaxAgeDays) {
        return {
            ruleType: "stale_thesis",
            status: "pass",
            decision: "allowed",
            label: "Fresh thesis check",
            message: `Linked thesis was reviewed ${Math.max(0, ageDays)} days ago.`,
            currentPct: pct,
            postPct: pct,
            thresholdPct: thesisMaxAgeDays,
            currentValue: tradeValue,
            postValue: tradeValue,
            thresholdValue: thesisMaxAgeDays,
            deltaPct: 0,
            direction: "neutral",
            impactedSymbols: [trade.ticker],
            overrideRequired: false,
        };
    }

    return {
        ruleType: "stale_thesis",
        status: "warn",
        decision: "override_required",
        label: "Fresh thesis check",
        message: `Linked thesis is ${ageDays} days old; policy asks for review within ${thesisMaxAgeDays} days before adding.`,
        currentPct: pct,
        postPct: pct,
        thresholdPct: thesisMaxAgeDays,
        currentValue: tradeValue,
        postValue: tradeValue,
        thresholdValue: thesisMaxAgeDays,
        deltaPct: 0,
        direction: "neutral",
        impactedSymbols: [trade.ticker],
        overrideRequired: true,
    };
}

function buildPostTradeHoldings(
    holdings: readonly NormalizedHolding[],
    tradeHolding: PolicyClassifiableHolding & ThemeExposureHolding,
    tradeValue: number,
    side: "buy" | "sell",
): NormalizedHolding[] {
    const symbol = normalizeSymbol(tradeHolding.symbol);
    let matched = false;
    const next = holdings.map((holding) => {
        if (normalizeSymbol(holding.symbol) !== symbol) return holding;
        matched = true;
        return {
            ...holding,
            marketValue: side === "buy"
                ? safeMoney(holding.marketValue) + tradeValue
                : Math.max(0, safeMoney(holding.marketValue) - tradeValue),
        };
    });
    if (!matched && side === "buy") {
        next.push({
            ...tradeHolding,
            symbol,
            marketValue: tradeValue,
        } as NormalizedHolding);
    }
    return next;
}

function holdingForTrade(
    trade: NormalizedTrade,
    tradeValue: number,
): PolicyClassifiableHolding & ThemeExposureHolding {
    return {
        id: `trade-${trade.ticker}`,
        symbol: trade.ticker,
        name: trade.ticker,
        marketValue: tradeValue,
        policyBucket: trade.policyBucket,
        instrumentType: trade.instrumentType === "option" ? "option" : "equity",
        themeWeights: trade.themeWeights,
    };
}

function summarizeImpact(
    checks: readonly PreTradeRiskPolicyCheck[],
    requiresOverride: boolean,
    overrideAccepted: boolean,
): string {
    const actionable = checks.filter((check) => check.status !== "pass");
    if (actionable.length === 0) {
        const reducing = checks.find((check) => check.direction === "risk_reducing");
        return reducing ? "Risk-reducing trade under current policy." : "Trade is inside current risk policy.";
    }
    if (requiresOverride && overrideAccepted) {
        return `${actionable.length} policy ${actionable.length === 1 ? "exception" : "exceptions"} with override captured.`;
    }
    if (requiresOverride) {
        return `${actionable.length} policy ${actionable.length === 1 ? "exception needs" : "exceptions need"} an override reason.`;
    }
    return `${actionable.length} policy ${actionable.length === 1 ? "warning" : "warnings"}.`;
}

function summarizeDirection(checks: readonly PreTradeRiskPolicyCheck[]): PreTradeRiskPolicyDirection {
    if (checks.some((check) => check.direction === "missing_data")) return "missing_data";
    if (checks.some((check) => check.status !== "pass" && check.direction === "risk_increasing")) return "risk_increasing";
    if (checks.some((check) => check.direction === "risk_reducing")) return "risk_reducing";
    return "neutral";
}

function emptyImpact(summary: string): PreTradeRiskPolicyImpact {
    return {
        decision: "allowed",
        blocksSubmit: false,
        requiresOverride: false,
        overrideAccepted: false,
        direction: "neutral",
        summary,
        checks: [],
        failedChecks: [],
        exceptionPreview: [],
    };
}

interface NormalizedHolding extends ThemeExposureHolding {
    symbol: string;
    marketValue: number;
}

interface NormalizedTrade extends Required<Pick<PreTradeRiskPolicyTrade, "ticker" | "side" | "quantity" | "price">> {
    instrumentType: "equity" | "option";
    marketValue: number;
    policyBucket?: PolicyBucketId | null;
    themeWeights?: readonly ThemeWeight[] | null;
    linkedThesisId?: string;
    thesisUpdatedAt?: string;
    optionPremiumAtRisk?: number;
}

function normalizeHoldings(holdings: readonly PreTradeRiskPolicyHolding[]): NormalizedHolding[] {
    return holdings.map((holding) => ({
        ...holding,
        symbol: normalizeSymbol(holding.symbol ?? holding.ticker),
        marketValue: safeMoney(holding.marketValue),
    }));
}

function normalizeTrade(trade: PreTradeRiskPolicyTrade): NormalizedTrade {
    const quantity = Number.isFinite(trade.quantity) ? Math.max(0, trade.quantity) : 0;
    const price = safeMoney(trade.price);
    const instrumentType = trade.instrumentType ?? "equity";
    const marketValue = safeMoney(
        trade.marketValue ??
        (instrumentType === "option" ? quantity * price * 100 : quantity * price),
    );
    return {
        ...trade,
        ticker: normalizeSymbol(trade.ticker),
        side: trade.side,
        quantity,
        price,
        instrumentType,
        marketValue,
        optionPremiumAtRisk: trade.optionPremiumAtRisk === undefined ? undefined : safeMoney(trade.optionPremiumAtRisk),
    };
}

function valueForSymbol(holdings: readonly NormalizedHolding[], symbol: string): number {
    const normalized = normalizeSymbol(symbol);
    return holdings
        .filter((holding) => normalizeSymbol(holding.symbol) === normalized)
        .reduce((sum, holding) => sum + safeMoney(holding.marketValue), 0);
}

function directionFor(currentPct: number, postPct: number): PreTradeRiskPolicyDirection {
    if (postPct > currentPct + 0.01) return "risk_increasing";
    if (postPct < currentPct - 0.01) return "risk_reducing";
    return "neutral";
}

function valueFromPct(pct: number, total: number): number {
    return roundMoney((safePercent(pct) / 100) * safeMoney(total));
}

function percentOf(value: number, total: number): number {
    return total > 0 ? (value / total) * 100 : 0;
}

function fmtPct(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
}

function normalizeSymbol(value: string | null | undefined): string {
    return value?.trim().toUpperCase() ?? "";
}

function safeMoney(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.round((value as number) * 100) / 100) : 0;
}

function safePercent(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundPct(value: number): number {
    return Math.round(value * 100) / 100;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function normalizeDate(value?: Date | string): Date {
    if (value instanceof Date) return value;
    if (typeof value === "string" && value.trim()) return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    return new Date();
}
