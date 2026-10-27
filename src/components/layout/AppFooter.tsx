import Link from "next/link";
import { withCallback } from "@/lib/auth/callback-url";

/**
 * The end of every page inside the app (launch item i64): that nothing here
 * is investment advice, where the data comes from, and the legal pages,
 * which bring the reader back to this page.
 */
export function AppFooter({ pathname }: { pathname: string }) {
    return (
        <footer className="pm-app-footer" data-testid="app-footer">
            <p>
                Not investment advice. Atlas Wealth never places trades or moves money. Market data from{" "}
                <a href="https://massive.com" target="_blank" rel="noreferrer">Massive</a>, filings from{" "}
                <a href="https://www.sec.gov/edgar" target="_blank" rel="noreferrer">SEC EDGAR</a>.
            </p>
            <nav aria-label="Legal">
                <Link href={withCallback("/terms", pathname)}>Terms of Service</Link>
                <Link href={withCallback("/privacy", pathname)}>Privacy Policy</Link>
            </nav>
        </footer>
    );
}
