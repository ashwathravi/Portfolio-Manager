"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    countNotInFile,
    decodeCsvBytes,
    describeImportCounts,
    describeImportResult,
    describeImportTotal,
    describeLinkedAccountRefusal,
    describeManualChange,
    describeNotInFile,
    groupImportByAccount,
    parseHoldingsCsv,
    planManualImport,
    type AccountImportGroup,
    type ExistingManualHolding,
    type ParseResult,
} from "@/lib/portfolio/csvImport";
import { describeOptionContract } from "@/lib/portfolio/option-positions";
import { localDate } from "@/lib/portfolio/value-dates";
import { formatQty, formatUsd } from "@/lib/format";

export interface ImportAccountOption {
    id: string;
    name: string;
    /**
     * A linked account that still syncs: its bank reports its holdings
     * without a ticker, so a file's can't be imported into it. One that
     * no longer syncs (disconnected) takes them like any other.
     */
    linked?: boolean;
}

/** One of the user's holdings valued by hand that an import into its account may update (added by hand or by an earlier file). */
export interface ImportableManualHolding extends ExistingManualHolding {
    portfolioId: string;
}

/**
 * What the user's accounts already hold that a file's rows with no ticker
 * may update or replace, for the preview: their holdings valued by hand an
 * import may update, and their positions (only those held under a CUSIP or
 * a plan's number matter).
 */
export interface ImportExisting {
    handValued: readonly ImportableManualHolding[];
    positions: readonly { accountId: string; symbol: string }[];
}

const NO_EXISTING: ImportExisting = { handValued: [], positions: [] };

const NEW_ACCOUNT = "__new__";

/** Account names compare without case or surrounding spaces, as Atlas keeps them unique. */
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("en-US") === b.trim().toLocaleLowerCase("en-US");

interface AccountTarget {
    /** An account's id, or NEW_ACCOUNT. */
    target: string;
    newName: string;
}

/**
 * Where each of a multi-account file's accounts goes to start with: the
 * Atlas account with its name, or a new account named after it.
 */
function initialTargets(groups: readonly AccountImportGroup[], accounts: readonly ImportAccountOption[]): Record<string, AccountTarget> {
    return Object.fromEntries(groups.map((g) => {
        const match = accounts.find((a) => sameName(a.name, g.account));
        return [g.account, { target: match?.id ?? NEW_ACCOUNT, newName: g.account }];
    }));
}

/**
 * Holdings › Import CSV. Choose a positions export from your broker, check
 * what was read (and what was not), pick the account, then import. Nothing
 * is sent until the user confirms the preview. Option rows go to the LEAPS
 * ledger (launch item i63). Rows with no ticker Atlas can price come in
 * valued by hand at the file's market value, as of the day the user gives
 * (`existing` lets the preview say which holdings they update or which
 * positions they replace); a linked account that still syncs can't take
 * them.
 */
export function ImportHoldingsDialog({
    accounts,
    existing = NO_EXISTING,
    triggerClassName = "pm-btn pm-btn-ghost",
}: {
    accounts: readonly ImportAccountOption[];
    existing?: ImportExisting;
    triggerClassName?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParseResult | null>(null);
    const [target, setTarget] = useState<string>(accounts[0]?.id ?? NEW_ACCOUNT);
    // Whether the user picked the target: "New account…" picked by hand is
    // kept, unlike the one the dialog starts on when there are no accounts.
    const targetChosen = useRef(false);
    const [newName, setNewName] = useState("Imported account");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // A multi-account file: where each of its accounts goes.
    const [accountTargets, setAccountTargets] = useState<Record<string, AccountTarget>>({});
    // The day the file's values are from: the browser's today once a file is read.
    const [valuesAsOf, setValuesAsOf] = useState("");
    const valuesDateAlertId = useId();

    const reset = () => {
        setFileName(null);
        setParsed(null);
        setAccountTargets({});
        setValuesAsOf("");
        setError(null);
        setSubmitting(false);
    };

    const onFile = async (file: File | undefined) => {
        setError(null);
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            setParsed(null);
            setError("That file is larger than 2 MB. Export positions only.");
            return;
        }
        setFileName(file.name);
        const result = parseHoldingsCsv(decodeCsvBytes(await file.arrayBuffer()));
        setParsed(result);
        setAccountTargets(initialTargets(groupImportByAccount(result), accounts));
        // A corrected file chosen again keeps the day the user gave.
        setValuesAsOf((current) => current || localDate());
    };

    const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
    const options = useMemo(() => parsed?.options ?? [], [parsed]);
    const manual = useMemo(() => parsed?.manual ?? [], [parsed]);
    const groups = useMemo(() => (parsed ? groupImportByAccount(parsed) : []), [parsed]);
    // One account in the file is the usual case: it goes where the user picks, as any file does.
    const multiAccount = groups.length > 1;
    const total = rows.length + options.length + manual.length;
    const chosen = groups.map((g) => accountTargets[g.account] ?? { target: NEW_ACCOUNT, newName: g.account });
    const chosenIds = chosen.flatMap((t) => (t.target === NEW_ACCOUNT ? [] : [t.target]));
    const chosenNewNames = chosen.flatMap((t) => (t.target === NEW_ACCOUNT ? [t.newName.trim()] : []));
    // Two of the file's accounts can't go to one Atlas account, nor two new ones share a name.
    const targetsClash = new Set(chosenIds).size !== chosenIds.length
        || chosenNewNames.some((n, i) => chosenNewNames.findIndex((m) => sameName(m, n)) !== i);
    const targetsReady = multiAccount
        ? chosenNewNames.every((n) => n.length > 0) && !targetsClash
        : target !== NEW_ACCOUNT || newName.trim().length > 0;
    // Rows valued by hand, each with the account it goes to and what it
    // changes there. Into a new account, every one is new.
    const today = localDate();
    const datedOk = /^\d{4}-\d{2}-\d{2}$/.test(valuesAsOf) && valuesAsOf >= "0001-01-01" && valuesAsOf <= today;
    const handValued = (multiAccount
        ? groups.map((g, i) => ({ label: g.account, manual: g.manual, target: chosen[i].target }))
        : [{ label: null, manual: groups[0]?.manual ?? manual, target }]
    ).filter((g) => g.manual.length > 0).map((g) => {
        const accountId = g.target === NEW_ACCOUNT ? null : g.target;
        const plan = planManualImport(
            accountId ? existing.handValued.filter((h) => h.portfolioId === accountId) : [],
            g.manual,
            {
                asOf: datedOk ? valuesAsOf : today,
                positions: accountId ? existing.positions.filter((p) => p.accountId === accountId).map((p) => p.symbol) : [],
            },
        );
        return { ...g, accountId, plan };
    });
    const planned = handValued.flatMap((g) => g.plan.map((change) => ({ account: g.label, change })));
    // Holdings an earlier file brought into a target account that this one leaves out: they stay.
    const notInFile = accounts.flatMap((account) => {
        if (!(multiAccount ? chosen.some((t) => t.target === account.id) : target === account.id)) return [];
        const left = countNotInFile(existing.handValued, planned.map((p) => p.change), account.id);
        return left > 0 ? [{ account: account.name, note: describeNotInFile(account.name, left) }] : [];
    });
    // A linked account's holdings without a ticker come from its bank while it syncs (LinkedAccountImportError).
    const linkedTargets = accounts.filter((a) => a.linked && handValued.some((g) => g.accountId === a.id));
    const canImport = total > 0 && parsed?.issues.length === 0 && !submitting && targetsReady
        && (manual.length === 0 || (datedOk && linkedTargets.length === 0));
    // Why the day keeps Import off: a later one, or none (cleared, or half typed).
    const valuesDateAlert = manual.length === 0 || datedOk ? null
        : valuesAsOf > today ? "Choose a date that isn't in the future." : "Choose the day these values are from.";
    // With rows valued by hand, the day their values are from: by the
    // browser's calendar, no later than its today.
    const valuesDateField = manual.length > 0 && (
        <label className="pm-exec-field">
            <span className="pm-exec-field-label">Values as of</span>
            <input
                type="date"
                className="pm-exec-input"
                value={valuesAsOf}
                max={today}
                required
                aria-describedby={valuesDateAlert ? valuesDateAlertId : undefined}
                onChange={(e) => setValuesAsOf(e.target.value)}
            />
        </label>
    );
    // What the file brings in: positions, or holdings once some are valued by hand.
    const totalLabel = describeImportTotal({ positions: rows.length + options.length, handValued: manual.length });
    const setAccountTarget = (account: string, change: Partial<AccountTarget>) =>
        setAccountTargets((current) => ({ ...current, [account]: { ...(current[account] ?? { target: NEW_ACCOUNT, newName: account }), ...change } }));

    const submit = async () => {
        if (!canImport) return;
        setSubmitting(true);
        setError(null);
        try {
            const destination = (t: AccountTarget) => (t.target === NEW_ACCOUNT ? { newPortfolioName: t.newName.trim() } : { portfolioId: t.target });
            // Only with rows valued by hand, so a file without them sends what it always has.
            const valuedByHand = (rowsByHand: typeof manual) => (rowsByHand.length > 0 ? { manual: rowsByHand, valuesAsOf } : {});
            const res = await fetch("/api/portfolio/import", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(multiAccount
                    ? { accounts: groups.map((g, i) => ({ ...destination(chosen[i]), rows: g.rows, options: g.options, ...valuedByHand(g.manual) })) }
                    : {
                        ...destination({ target, newName }),
                        // Without the account the file named.
                        rows: groups[0]?.rows ?? rows,
                        options: groups[0]?.options ?? options,
                        ...valuedByHand(groups[0]?.manual ?? manual),
                    }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body?.error ?? `Import failed (${res.status}).`);
                setSubmitting(false);
                return;
            }
            type Counts = {
                insert: number;
                update: number;
                unchanged: number;
                options?: { insert: number; update: number; unchanged: number };
                manual?: { insert: number; update: number; unchanged: number; replacedPositions: number };
            };
            const results: Counts[] = multiAccount ? body.data.accounts : [body.data];
            const sum = (pick: (c: Counts) => number) => results.reduce((n, c) => n + pick(c), 0);
            toast.success(describeImportResult(
                { positions: rows.length, options: options.length, handValued: manual.length, accounts: multiAccount ? groups.length : 1 },
                {
                    positions: { insert: sum((c) => c.insert), update: sum((c) => c.update), unchanged: sum((c) => c.unchanged) },
                    options: { insert: sum((c) => c.options?.insert ?? 0), update: sum((c) => c.options?.update ?? 0), unchanged: sum((c) => c.options?.unchanged ?? 0) },
                    handValued: {
                        insert: sum((c) => c.manual?.insert ?? 0),
                        update: sum((c) => c.manual?.update ?? 0),
                        unchanged: sum((c) => c.manual?.unchanged ?? 0),
                        replacedPositions: sum((c) => c.manual?.replacedPositions ?? 0),
                    },
                },
            ));
            setOpen(false);
            reset();
            router.refresh();
        } catch {
            setError("Could not reach the server. Nothing was imported.");
            setSubmitting(false);
        }
    };

    return (
        <>
            <button
                type="button"
                className={triggerClassName}
                onClick={() => {
                    // The accounts can change while the dialog is closed (one
                    // just created, one deleted): keep a target that still
                    // exists, or a new account the user chose, otherwise the
                    // first account.
                    setTarget((current) => {
                        if (current === NEW_ACCOUNT ? targetChosen.current : accounts.some((a) => a.id === current)) return current;
                        targetChosen.current = false;
                        return accounts[0]?.id ?? NEW_ACCOUNT;
                    });
                    setOpen(true);
                }}
            >
                Import CSV
            </button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) reset();
                }}
            >
                <DialogContent className="sm:max-w-2xl" data-testid="import-dialog">
                    <DialogHeader>
                        <DialogTitle>Import holdings from CSV</DialogTitle>
                        <DialogDescription>
                            Use your broker&apos;s positions export. Atlas reads the symbol, quantity, and average cost
                            (or total cost basis), and the account when the file covers several. A symbol you already
                            hold in the chosen account is replaced; other positions are left alone. A holding with no
                            ticker, such as a 401(k) trust known by its name or CUSIP, comes in valued by hand at the
                            file&apos;s market value. Option rows go to the LEAPS ledger, priced per share from the total
                            cost basis, or else the average cost; check the preview.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="pm-import-body">
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">CSV file</span>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                aria-label="CSV file"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    // Clear the selection so choosing the same, corrected
                                    // file again still fires change and re-parses it.
                                    e.target.value = '';
                                    void onFile(file);
                                }}
                            />
                        </label>

                        {parsed && (
                            <div className="pm-import-preview" data-testid="import-preview">
                                <p className="pm-import-summary">
                                    {fileName}: {describeImportCounts({
                                        positions: rows.length,
                                        handValued: manual.length,
                                        options: options.length,
                                        accounts: multiAccount ? groups.length : 1,
                                    })} ready
                                    {parsed.issues.length > 0 && `, ${parsed.issues.length} ${parsed.issues.length === 1 ? "row needs" : "rows need"} attention`}
                                    {parsed.skipped > 0 && `, ${parsed.skipped} cash or total row${parsed.skipped === 1 ? "" : "s"} skipped`}.
                                </p>
                                {rows.length > 0 && (
                                    <div className="pm-table-scroll pm-import-table">
                                        <table className="pm-table-full" aria-label="Positions to import">
                                            <thead>
                                                <tr>
                                                    {multiAccount && <th scope="col">Account</th>}
                                                    <th scope="col">Symbol</th>
                                                    <th scope="col">Name</th>
                                                    <th scope="col" className="num">Quantity</th>
                                                    <th scope="col" className="num">Avg cost</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.slice(0, 50).map((r) => (
                                                    <tr key={`${r.account ?? ""}-${r.symbol}`}>
                                                        {multiAccount && <td>{r.account}</td>}
                                                        <td>{r.symbol}</td>
                                                        <td>{r.name || "—"}</td>
                                                        <td className="num">{formatQty(r.quantity)}</td>
                                                        <td className="num">{formatUsd(r.avgCost)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {rows.length > 50 && <p className="pm-import-more">…and {rows.length - 50} more</p>}
                                    </div>
                                )}
                                {options.length > 0 && (
                                    <div className="pm-table-scroll pm-import-table">
                                        <table className="pm-table-full" aria-label="Option positions to import">
                                            <thead>
                                                <tr>
                                                    <th scope="col">Option</th>
                                                    <th scope="col" className="num">Contracts</th>
                                                    <th scope="col" className="num">Premium / share</th>
                                                    <th scope="col" className="num">Cost</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {options.slice(0, 50).map((o) => (
                                                    <tr key={`${o.account ?? ""}-${o.underlying}-${o.expiry}-${o.contractType}-${o.strike}`}>
                                                        <td>{describeOptionContract(o)}</td>
                                                        <td className="num">{formatQty(o.quantity)}</td>
                                                        <td className="num">{formatUsd(o.premium)}</td>
                                                        <td className="num">{formatUsd(Math.abs(o.quantity) * o.premium * 100)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {options.length > 50 && <p className="pm-import-more">…and {options.length - 50} more</p>}
                                    </div>
                                )}
                                {planned.length > 0 && (
                                    <>
                                        <div className="pm-table-scroll pm-import-table">
                                            <table className="pm-table-full" aria-label="Holdings valued by hand to import">
                                                <thead>
                                                    <tr>
                                                        {multiAccount && <th scope="col">Account</th>}
                                                        <th scope="col">Holding</th>
                                                        <th scope="col" className="num">Units</th>
                                                        <th scope="col" className="num">Value</th>
                                                        <th scope="col" className="num">Cost</th>
                                                        <th scope="col">In Atlas</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {planned.slice(0, 50).map(({ account, change }) => (
                                                        <tr key={`${account ?? ""}-${change.key}`}>
                                                            {multiAccount && <td>{account}</td>}
                                                            <td>
                                                                <div>{change.row.name}</div>
                                                                {change.row.identifier && <div className="pm-card-subtitle">{change.row.identifier}</div>}
                                                            </td>
                                                            <td className="num">{change.row.quantity == null ? "—" : formatQty(change.row.quantity)}</td>
                                                            <td className="num">{formatUsd(change.row.value)}</td>
                                                            <td className="num">{change.row.costBasis == null ? "—" : formatUsd(change.row.costBasis)}</td>
                                                            <td>{describeManualChange(change)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {planned.length > 50 && <p className="pm-import-more">…and {planned.length - 50} more</p>}
                                        </div>
                                        <p className="pm-import-note">
                                            Atlas can&apos;t price these, so each counts at the file&apos;s value until the next import or your own update.
                                        </p>
                                        {notInFile.map(({ account, note }) => (
                                            <p key={account} className="pm-import-note" data-testid="import-not-in-file">
                                                {note}
                                            </p>
                                        ))}
                                    </>
                                )}
                                {parsed.issues.length > 0 && (
                                    <>
                                        <p role="alert">Fix the listed issues and upload the CSV again before importing.</p>
                                        <ul className="pm-import-issues" aria-label="Rows not imported">
                                            {parsed.issues.slice(0, 10).map((i) => (
                                                <li key={`${i.line}-${i.message}`}>
                                                    Line {i.line}: {i.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                        )}

                        {total > 0 && multiAccount && (
                            <div className="pm-import-target" data-testid="import-account-targets">
                                <p className="pm-exec-field-label">Where each account goes</p>
                                {groups.map((g, i) => {
                                    const t = chosen[i];
                                    return (
                                        <div key={g.account} className="pm-form-pair" data-testid="import-account-target">
                                            <label className="pm-exec-field">
                                                <span className="pm-exec-field-label">
                                                    {g.account} ({describeImportTotal({ positions: g.rows.length + g.options.length, handValued: g.manual.length })})
                                                </span>
                                                <select
                                                    className="pm-exec-input"
                                                    value={t.target}
                                                    onChange={(e) => setAccountTarget(g.account, { target: e.target.value })}
                                                >
                                                    {accounts.map((a) => (
                                                        <option key={a.id} value={a.id}>
                                                            {a.name}
                                                        </option>
                                                    ))}
                                                    <option value={NEW_ACCOUNT}>New account…</option>
                                                </select>
                                            </label>
                                            {t.target === NEW_ACCOUNT && (
                                                <label className="pm-exec-field">
                                                    <span className="pm-exec-field-label">New account name</span>
                                                    <input
                                                        className="pm-exec-input"
                                                        value={t.newName}
                                                        maxLength={80}
                                                        aria-label={`New account name for ${g.account}`}
                                                        onChange={(e) => setAccountTarget(g.account, { newName: e.target.value })}
                                                    />
                                                </label>
                                            )}
                                        </div>
                                    );
                                })}
                                {valuesDateField}
                                {targetsClash && (
                                    <p role="alert">Each of the file&apos;s accounts needs its own Atlas account.</p>
                                )}
                            </div>
                        )}

                        {total > 0 && !multiAccount && (
                            <div className="pm-import-target">
                                <label className="pm-exec-field">
                                    <span className="pm-exec-field-label">Import into</span>
                                    <select
                                        className="pm-exec-input"
                                        value={target}
                                        onChange={(e) => {
                                            targetChosen.current = true;
                                            setTarget(e.target.value);
                                        }}
                                    >
                                        {accounts.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.name}
                                            </option>
                                        ))}
                                        <option value={NEW_ACCOUNT}>New account…</option>
                                    </select>
                                </label>
                                {target === NEW_ACCOUNT && (
                                    <label className="pm-exec-field">
                                        <span className="pm-exec-field-label">New account name</span>
                                        <input
                                            className="pm-exec-input"
                                            value={newName}
                                            maxLength={80}
                                            onChange={(e) => setNewName(e.target.value)}
                                        />
                                    </label>
                                )}
                                {valuesDateField}
                            </div>
                        )}

                        {valuesDateAlert && (
                            <p id={valuesDateAlertId} className="pm-import-error" role="alert">{valuesDateAlert}</p>
                        )}
                        {linkedTargets.map((account) => (
                            <p key={account.id} className="pm-import-error" role="alert">
                                {describeLinkedAccountRefusal(account.name)}
                            </p>
                        ))}

                        {error && (
                            <p className="pm-import-error" role="alert">
                                {error}
                            </p>
                        )}
                    </div>

                    <DialogFooter>
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </button>
                        <button type="button" className="pm-btn pm-btn-primary" disabled={!canImport} onClick={submit}>
                            {submitting ? "Importing…" : total > 0 ? `Import ${totalLabel}` : "Import"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
