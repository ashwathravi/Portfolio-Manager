"use client";

import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";
import { FocusVariant } from "./FocusVariant";

/**
 * Trade (/execution).
 *
 * One ticket design: the order form beside the blotter and approval queue.
 * The design review retired the Checkout and Terminal variants — users
 * shouldn't have to pick a layout to place an order.
 *
 * Orders never route to a broker from here: tickets draft into the
 * blotter for review, and the blotter, buying power, and prices are
 * example data until a brokerage is connected.
 */

const HEADER = {
    title: "Trade",
    subtitle: "Draft orders, check them against your rules, then route them yourself",
    crumbs: ["Trade"],
};

export function ExecutionPageClient() {
    usePageHeader(HEADER);
    const showSample = useShowSampleData();

    if (!showSample) {
        return (
            <div className="pm-exec-page">
                <SampleEmptyState
                    title="No brokerage connected"
                    body="The order ticket needs live prices and buying power from a connected brokerage. Example orders and prices are hidden."
                />
            </div>
        );
    }

    return (
        <div className="pm-exec-page" data-variant="focus">
            <SampleDataNotice>
                Prices, buying power, and the order blotter are examples. Drafted orders stay in this tab.
            </SampleDataNotice>
            <FocusVariant />
        </div>
    );
}
