"use client";

import Link from "next/link";

import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import type { TradeTicketData } from "@/lib/execution/ticket";
import { FocusVariant } from "./FocusVariant";

/**
 * Trade (/execution).
 *
 * One ticket design: the order form beside the blotter and approval queue.
 * The design review retired the Checkout and Terminal variants — users
 * shouldn't have to pick a layout to place an order.
 *
 * On the user's own data (launch item i53): an order is drafted for one of
 * their accounts, against its cash and positions, and saved for them to
 * place at their broker. Without an account there's nothing to draft
 * against, so the page says to add one.
 */

const HEADER = {
    title: "Trade",
    subtitle: "Draft orders, check them against your rules, then place them yourself",
    crumbs: ["Trade"],
};

export function ExecutionPageClient({ ticket }: { ticket: TradeTicketData }) {
    usePageHeader(HEADER);

    if (ticket.unavailable) {
        return (
            <div className="pm-exec-page">
                <DataUnavailableNotice what="your accounts and orders" />
            </div>
        );
    }

    if (ticket.accounts.length === 0) {
        return (
            <div className="pm-exec-page">
                <section className="pm-card pm-empty-card" data-testid="trade-needs-account">
                    <h2>Add an account to draft orders</h2>
                    <p>
                        Each order is drafted for one of your accounts and checked against its cash and positions.
                        Atlas never places orders: you place them at your broker.
                    </p>
                    <div className="pm-empty-actions">
                        <Link href="/portfolios/accounts" className="pm-btn pm-btn-primary">Add an account</Link>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div className="pm-exec-page" data-variant="focus">
            <FocusVariant ticket={ticket} />
        </div>
    );
}
