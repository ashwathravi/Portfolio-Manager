/**
 * Shown when the database is configured but a read failed, in place of an
 * empty state, so an outage never reads as "you have no accounts".
 */
export function DataUnavailableNotice({ what = "your portfolios" }: { what?: string }) {
    return (
        <div className="pm-data-unavailable" role="alert" data-testid="data-unavailable">
            <strong>We couldn&apos;t load {what}.</strong>{" "}
            <span>This is a problem on our side, not with your accounts. Try reloading in a minute.</span>
        </div>
    );
}
