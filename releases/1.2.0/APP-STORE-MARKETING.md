# KaamKoRecord 1.2.0 — App Store copy and creative plan

Prepared 9 October 2026 (Australia/Sydney). Copy is grounded in this release's FEATURES.md. Files are prepared locally; no App Store Connect changes or submission have been made.

## Fields to paste

- What's New: `app-store-whats-new-short.txt` (concise alternative to the existing longer notes).
- Promotional Text: `app-store-promotional-text.txt`.
- Description: `app-store-description.txt`.
- Keywords: `app-store-keywords.txt`.
- Version: `1.2.0`. Intended iOS binary: build `10`, recorded in builds.json.
- App Review Notes: `app-review-notes-draft.txt`, after checking the steps against the installed build. Attach `reviewer-catalogue.csv` for a small sample import.
- Sign-in required: enabled. Supply a working reviewer account in the dedicated fields. Prepare two sample catalogues and a few shifts in that account so the main flows can be reviewed immediately.
- Contact, support URL and copyright: use the app owner's real contact details, public support page and legal copyright holder. These values were not supplied; no identity or support URL has been invented.
- Marketing URL: optional; use a public app landing page if available.

## Cover assets and placement

Apple's current specifications allow an opaque PNG header at 3840 × 1646 and search artwork at 1920 × 1280 through 3840 × 2560 (3:2). An alternative universal PNG is 5244 × 2950. The supplied package uses separate header and search compositions; do not upload the header as a screenshot.

Use the revised `marketing/header-v2-3840x1646.png` in Header and `marketing/search-v2-3840x2560.png` in Search Results. These preserve the clock logo and illustrate shift hours, timesheets and named item catalogues. The original covers are retained as earlier alternatives. `marketing/ASSETS.md` records the export process. Both are upscaled from generated sources, so check sharpness in the console. In App Store Connect, upload through the Asset Library, assign each asset to its placement, then inspect Preview on all shown layouts. Keep the clock and catalogue motif centered; cropping may vary. Apple reviews creative assets as well as version metadata.

The covers use conceptual artwork related to the app's core experience. Screenshot slots must show the real app. The search illustration is a brand option; test it against a real-interface creative once captured.

Specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
Best practices and templates: https://developer.apple.com/app-store/asset-best-practices/

## Marketing strategy

Position the default page around one promise: organize your working day. Lead with shift tracking, then introduce private catalogues as the differentiating feature. Keep the navy and green branding consistent across creative assets and screenshots.

Capture real screenshots in this sequence:
1. Clock and breaks — "Keep track of your shift".
2. Timesheet or calendar — "See your working hours".
3. Catalogue chooser — "Your lists, kept separate".
4. Item search — "Find items your way".
5. CSV mapping — "Bring your own catalogue".
6. Alerts and appearance — "Keep your tools close".

Use sample data without personal information. Capture the release build on the required iPhone and iPad sizes shown in App Store Connect; do not stretch screenshots or generate fictional interface screens. A future app preview should record the actual clock, catalogue switch and search flow.

Create two custom product pages after the default page is ready:
- Shift tracking audience: lead with Clock and Timesheets screenshots. Promotional text: "Track shifts, record breaks and review your working hours. Keep your timesheets and workplace details together with KaamKoRecord."
- Catalogue audience: lead with catalogue import and search. Promotional text: "Bring your own CSV lists, save private named catalogues and search the columns that matter to you. Keep Meat, Groceries and other lists separate."

Send relevant campaigns to each page's unique URL. Apple supports different screenshots, previews, promotional text and keywords on custom pages; submit those pages for review. This is a suggested campaign structure, not a forecast of results.

Use product page optimization to test one alternative header against the default. Keep the other metadata stable to make the result interpretable. Compare App Store Connect's conversion results and test confidence before choosing a winner. Evaluate campaign pages separately by traffic source and download conversion. Header, search artwork and screenshot slots serve different placements; verify eligibility for each test in the current console.

Custom page guidance: https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions
Header testing guidance: https://developer.apple.com/app-store/asset-best-practices/

## Review and release readiness

Select build 10 only after processing and device testing. Check reviewer sign-in, both catalogue flows, clock/breaks, alerts and notification taps on a physical device. The release record says physical-device push testing was outstanding.

The earlier README recorded a 404 for `/api/v1/items/search/`. A new unauthenticated check on 9 October 2026 returned HTTP 401, indicating the endpoint now requires authentication; this does not verify successful authenticated catalogue operations. Confirm those using the release build before submission.

Recommended release choices: manual release for control over timing, seven-day phased updates after approval, and keep existing ratings. These are recommendations only; no settings were changed. Confirm the backend and reviewer account are ready before Add for Review.
