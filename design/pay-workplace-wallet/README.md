# Workplace pay wallet

Pay now uses the reference's dark summary, softly coloured swipeable cards, page dots and grouped activity rows. Each card represents a real workplace rather than a bank card. Swipe, tap a card/dot, or use the arrows to switch its details. The same design is implemented in native UI and on the website, with light/dark theme support.

The overview combines unpaid hours only. Each workplace keeps its own estimated gross pay, pay periods, coverage choice, Payment received action, last payment and confirmed Undo. A workplace without a rate shows its hours and a link to add a rate. An all-clear state and workplace creation remain available. No payroll calculation or payment permissions were changed.

The website supports keyboard arrow/Home/End selection and remembers the chosen workplace for the session. Native scrolling handles both momentum swipes and slow drags; reduced motion disables animated card movement. All workplace controls are reachable at narrow phone widths.

Evidence uses the actual website and Expo native components against a separate preview database containing three sample workplaces. No real user's financial data was used or changed. Screenshots show the wallet and its pay details. Browser checks exercised real touch swipes, dot/arrow selection, payment cancellation, workplace-specific recording, Undo, missing-rate states and 320/768px layouts.

Validation: all 350 Timeclock/API backend tests, all 139 native tests, nine JavaScript tests and TypeScript passed. Lint has zero errors and the existing 24 warnings. Django and JavaScript syntax checks passed. iOS, Android and web bundle exports succeeded. Native previews use Expo's browser renderer, not a device simulator.

Changes remain local, pending deployment and an updated mobile build.

The isolated payment checks restored the original payment state and left all eight sample shifts intact. The preview server, database and temporary credentials were removed after verification.
