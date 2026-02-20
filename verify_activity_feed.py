from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000")

        # Wait for the dashboard to load
        page.wait_for_selector("text=Recent Activity")

        # Take a screenshot of the whole page first
        page.screenshot(path="verification_dashboard.png")

        # Locate the Activity Feed card
        # It's a card with title "Recent Activity"
        # We can find the card by finding the text and going up to the card container
        # But easier is to just take a screenshot of the element containing "Recent Activity"

        # Find the card that contains "Recent Activity"
        # CardHeader contains CardTitle which contains "Recent Activity"
        # Card is the parent of CardHeader

        # Let's try to select the card more robustly.
        # We know it's a Card.
        # We can just screenshot the whole page, but maybe crop it?

        # Let's just screenshot the element with text "Recent Activity" and its parent.
        # But the parent of parent is the Card.

        # Using xpath to find the card
        card = page.locator("//div[contains(@class, 'rounded-lg') and .//h3[contains(text(), 'Recent Activity')]]").first

        if card.count() > 0:
            card.screenshot(path="verification_activity_feed.png")
            print("Screenshot saved to verification_activity_feed.png")
        else:
            print("Could not find Activity Feed card, saving full page")
            page.screenshot(path="verification_full_page.png")

        browser.close()

if __name__ == "__main__":
    run()
