export const CASH_JOB_TYPES = [
    "emergency_fund",
    "tax_reserve",
    "near_term_spending",
    "opportunistic_reserve",
    "scheduled_deployment",
    "settlement",
    "unassigned",
] as const;

export type CashJobType = (typeof CASH_JOB_TYPES)[number];

export type CashPolicyStatus = "inside" | "watch" | "breached" | "missing_data";

export interface CashJob {
    id: string;
    type: CashJobType;
    label: string;
    amount: number;
    targetAmount?: number;
    monthlyExpenses?: number;
    monthsTarget?: number;
    reviewBy?: string;
    destination?: string;
}

export interface CashDeploymentRule {
    enabled: boolean;
    cadence: "monthly" | "quarterly";
    percentOfExcess: number;
    destination: string;
    nextDueDate?: string;
    lastAcknowledgedAt?: string;
    unassignedAcknowledgedUntil?: string;
}

export interface CashPolicySummaryInput {
    totalCash: number;
    jobs?: CashJob[];
    deploymentRule?: CashDeploymentRule | null;
    asOf?: Date | string;
}

export interface CashJobAllocation {
    id: string;
    type: CashJobType;
    label: string;
    amount: number;
    targetAmount?: number;
    reserved: boolean;
    deployment: boolean;
    reviewBy?: string;
    destination?: string;
}

export interface CashPolicySummary {
    totalCash: number;
    assignedCash: number;
    reservedCash: number;
    deploymentCash: number;
    excessCash: number;
    unassignedCash: number;
    overAllocatedCash: number;
    assignedPct: number;
    status: CashPolicyStatus;
    jobs: CashJobAllocation[];
    deploymentRule: CashDeploymentRule;
    deploymentDue: boolean;
    nextDeploymentAmount: number;
    nextDueDate?: string;
    actionPrompts: string[];
}

export const CASH_JOB_LABELS: Record<CashJobType, string> = {
    emergency_fund: "Emergency fund",
    tax_reserve: "Tax reserve",
    near_term_spending: "Near-term spending",
    opportunistic_reserve: "Opportunistic reserve",
    scheduled_deployment: "Scheduled deployment",
    settlement: "Brokerage settlement",
    unassigned: "Unassigned",
};

export const DEFAULT_CASH_DEPLOYMENT_RULE: CashDeploymentRule = {
    enabled: false,
    cadence: "monthly",
    percentOfExcess: 25,
    destination: "Core allocation",
};

const RESERVED_JOB_TYPES = new Set<CashJobType>([
    "emergency_fund",
    "tax_reserve",
    "near_term_spending",
    "opportunistic_reserve",
    "settlement",
]);

const DEPLOYMENT_JOB_TYPES = new Set<CashJobType>(["scheduled_deployment"]);

export function computeCashPolicySummary(input: CashPolicySummaryInput): CashPolicySummary {
    const totalCash = safeMoney(input.totalCash);
    const asOf = normalizeDate(input.asOf);
    const deploymentRule = normalizeDeploymentRule(input.deploymentRule);
    const jobs = normalizeCashJobs(input.jobs ?? []);

    const assignedCash = roundMoney(
        jobs
            .filter((job) => job.type !== "unassigned")
            .reduce((total, job) => total + job.amount, 0),
    );
    const allJobCash = roundMoney(jobs.reduce((total, job) => total + job.amount, 0));
    const reservedCash = roundMoney(
        jobs
            .filter((job) => job.reserved)
            .reduce((total, job) => total + job.amount, 0),
    );
    const deploymentCash = roundMoney(
        jobs
            .filter((job) => job.deployment)
            .reduce((total, job) => total + job.amount, 0),
    );
    const excessCash = roundMoney(Math.max(0, totalCash - reservedCash));
    const unassignedCash = roundMoney(Math.max(0, totalCash - assignedCash));
    const overAllocatedCash = roundMoney(Math.max(0, allJobCash - totalCash));
    const assignedPct = totalCash > 0 ? (Math.min(assignedCash, totalCash) / totalCash) * 100 : assignedCash > 0 ? 100 : 0;

    const nextDueDate = deploymentRule.nextDueDate;
    const deploymentDue = Boolean(
        deploymentRule.enabled &&
            nextDueDate &&
            parseDateOnly(nextDueDate).getTime() <= startOfDay(asOf).getTime() &&
            excessCash > 0,
    );
    const nextDeploymentAmount = deploymentRule.enabled
        ? roundMoney(excessCash * (deploymentRule.percentOfExcess / 100))
        : 0;
    const unassignedAcknowledged = Boolean(
        deploymentRule.unassignedAcknowledgedUntil &&
            parseDateOnly(deploymentRule.unassignedAcknowledgedUntil).getTime() >= startOfDay(asOf).getTime(),
    );

    const actionPrompts: string[] = [];
    let status: CashPolicyStatus = "inside";

    if (overAllocatedCash > 0) {
        status = "breached";
        actionPrompts.push(`Reduce cash job allocations by ${formatCurrency(overAllocatedCash)} or raise total cash.`);
    } else if (unassignedCash > 0 && !unassignedAcknowledged) {
        status = "missing_data";
        actionPrompts.push(`Assign ${formatCurrency(unassignedCash)} to a cash job or acknowledge it with an expiry.`);
    } else if (deploymentRule.enabled && !nextDueDate && excessCash > 0) {
        status = "missing_data";
        actionPrompts.push("Set the next scheduled deployment date.");
    } else if (deploymentDue && nextDeploymentAmount > 0) {
        status = "watch";
        actionPrompts.push(`Deploy ${formatCurrency(nextDeploymentAmount)} to ${deploymentRule.destination}.`);
    } else if (unassignedCash > 0 && unassignedAcknowledged) {
        status = "watch";
        actionPrompts.push(`Review ${formatCurrency(unassignedCash)} unassigned cash by ${deploymentRule.unassignedAcknowledgedUntil}.`);
    }

    return {
        totalCash,
        assignedCash,
        reservedCash,
        deploymentCash,
        excessCash,
        unassignedCash,
        overAllocatedCash,
        assignedPct,
        status,
        jobs,
        deploymentRule,
        deploymentDue,
        nextDeploymentAmount,
        nextDueDate,
        actionPrompts,
    };
}

export function advanceCashDeploymentDate(date: string, cadence: CashDeploymentRule["cadence"]): string {
    const current = parseDateOnly(date);
    const next = new Date(Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth() + (cadence === "quarterly" ? 3 : 1),
        current.getUTCDate(),
    ));
    return next.toISOString().slice(0, 10);
}

function normalizeCashJobs(jobs: CashJob[]): CashJobAllocation[] {
    return jobs
        .map((job) => {
            const amount = safeMoney(job.amount);
            return {
                id: job.id,
                type: job.type,
                label: job.label.trim() || CASH_JOB_LABELS[job.type],
                amount,
                targetAmount: job.targetAmount === undefined ? undefined : safeMoney(job.targetAmount),
                reserved: RESERVED_JOB_TYPES.has(job.type),
                deployment: DEPLOYMENT_JOB_TYPES.has(job.type),
                reviewBy: job.reviewBy,
                destination: job.destination,
            };
        })
        .filter((job) => job.amount > 0 && CASH_JOB_TYPES.includes(job.type));
}

function normalizeDeploymentRule(rule?: CashDeploymentRule | null): CashDeploymentRule {
    if (!rule) {
        return { ...DEFAULT_CASH_DEPLOYMENT_RULE };
    }

    return {
        ...DEFAULT_CASH_DEPLOYMENT_RULE,
        ...rule,
        cadence: rule.cadence === "quarterly" ? "quarterly" : "monthly",
        percentOfExcess: clampPercent(rule.percentOfExcess),
        destination: rule.destination.trim() || DEFAULT_CASH_DEPLOYMENT_RULE.destination,
    };
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_CASH_DEPLOYMENT_RULE.percentOfExcess;
    }
    return Math.min(100, Math.max(0, value));
}

function safeMoney(value: number): number {
    return roundMoney(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function normalizeDate(value?: Date | string): Date {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        return parseDateOnly(value);
    }
    return new Date();
}

function parseDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function startOfDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}
