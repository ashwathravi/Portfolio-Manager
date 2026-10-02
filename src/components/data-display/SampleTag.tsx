/**
 * Marks a figure or card that is built from example data rather than the
 * user's own accounts. Every number in the app is either traceable to the
 * database or carries this tag — mixing the two unlabelled was the biggest
 * trust problem in the design review.
 */
export function SampleTag({ label = "Sample", title }: { label?: string; title?: string }) {
    return (
        <span
            className="pm-sample-tag"
            data-testid="sample-tag"
            title={title ?? "Example data. Connect an account in Settings to see your own, or hide examples in Settings."}
        >
            {label}
        </span>
    );
}
