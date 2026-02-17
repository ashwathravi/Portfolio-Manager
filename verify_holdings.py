from playwright.sync_api import sync_playwright

def verify_holdings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to holdings page...")
            page.goto("http://localhost:3000/portfolios/holdings")
            print("Waiting for table...")
            # Wait for the table to appear. If it doesn't appear, something is wrong.
            page.wait_for_selector("table", timeout=10000)

            # Verify we see the holdings
            content = page.content()
            if "Apple Inc." not in content:
                print("WARNING: 'Apple Inc.' not found in page content.")

            print("Taking screenshot...")
            page.screenshot(path="verification_holdings.png")
            print("Screenshot saved to verification_holdings.png")
        except Exception as e:
            print(f"Error: {e}")
            # Try to print some page content if possible
            try:
                print("Page content snippet:", page.content()[:500])
            except:
                pass
        finally:
            browser.close()

if __name__ == "__main__":
    verify_holdings()
